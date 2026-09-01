import { and, eq, or, sql, isNull, desc } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db, firstRow } from '@/db';
import {
  leads, leadAttribution, leadTokens, leadMergeCandidates,
  users, userRoles, forms, formVersions, formQuestions,
  formSubmissions, formAnswers, launches,
} from '@/db/schema';
import { normalizePhone, normalizeEmail, normalizeName } from '@/lib/phone';
import { emit, logActivity } from './events';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ── Deduplicación ───────────────────────────────────────────────────────
 * Orden de confianza (D5 §10). La regla que no se rompe nunca:
 * NO se fusionan dos personas solo porque se parezca el nombre.
 * Un duplicado revisable es mucho mejor que dos personas fusionadas mal.
 */

export type MatchResult =
  | { kind: 'exact'; leadId: string; confidence: number; method: string }
  | { kind: 'candidate'; leadId: string; confidence: number; method: string }
  | { kind: 'none' };

export async function findExistingLead(
  tx: Tx | typeof db,
  input: { phone?: string | null; email?: string | null; name?: string | null },
): Promise<MatchResult> {
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);

  if (!phone && !email) return { kind: 'none' };

  const conditions = [];
  if (phone) conditions.push(eq(leads.phoneNormalized, phone));
  if (email) conditions.push(eq(leads.emailNormalized, email));

  const rows = await tx
    .select()
    .from(leads)
    .where(and(or(...conditions), isNull(leads.mergedIntoLeadId)))
    .limit(5);

  if (rows.length === 0) return { kind: 'none' };

  // 1. Teléfono exacto → confianza máxima.
  const byPhone = phone && rows.find((r) => r.phoneNormalized === phone);
  if (byPhone) return { kind: 'exact', leadId: byPhone.id, confidence: 1.0, method: 'phone_exact' };

  // 2. Email exacto → confianza alta.
  const byEmail = email && rows.find((r) => r.emailNormalized === email);
  if (byEmail) {
    // Si el email coincide pero el teléfono es OTRO distinto y conocido,
    // puede ser un email familiar compartido. No se auto-fusiona.
    const conflict = phone && byEmail.phoneNormalized && byEmail.phoneNormalized !== phone;
    if (conflict) {
      return { kind: 'candidate', leadId: byEmail.id, confidence: 0.80, method: 'email_exact_phone_conflict' };
    }
    return { kind: 'exact', leadId: byEmail.id, confidence: 0.98, method: 'email_exact' };
  }

  return { kind: 'none' };
}

/* ── Asignación de setter ────────────────────────────────────────────── */

/** Round-robin entre setters activos, por antigüedad de la última asignación. */
async function pickSetter(tx: Tx): Promise<string | null> {
  const candidates = await tx
    .select({ id: users.id, lastAssignedAt: users.lastAssignedAt })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleCode, 'setter'), eq(users.active, true)))
    .orderBy(sql`${users.lastAssignedAt} nulls first`)
    .limit(1);

  if (candidates.length === 0) return null;

  await tx.update(users).set({ lastAssignedAt: new Date() }).where(eq(users.id, candidates[0].id));
  return candidates[0].id;
}

/* ── Tokens ──────────────────────────────────────────────────────────── */

/**
 * Enlace identificado por lead. Sin esto no se sabe quién rellenó el
 * formulario de perfil: un link genérico obliga a hacer matching otra vez,
 * con el mismo riesgo de fusionar mal que en Calendly.
 */
export async function issueToken(
  tx: Tx, leadId: string, purpose: 'profile_form' | 'whatsapp_group' | 'class',
): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await tx.insert(leadTokens).values({ token, leadId, purpose });
  return token;
}

/* ── Alta de lead ────────────────────────────────────────────────────── */

export type AttributionInput = {
  source?: string;
  campaign_id?: string; campaign_name?: string;
  adset_id?: string; adset_name?: string;
  ad_id?: string; ad_name?: string;
  creative_id?: string; placement?: string;
  utm_source?: string; utm_medium?: string; utm_campaign?: string;
  utm_content?: string; utm_term?: string;
  fbclid?: string; _fbp?: string; _fbc?: string;
  landing_url?: string; referrer_url?: string;
  [k: string]: unknown;
};

export type CreateLeadInput = {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  attribution?: { first_touch?: AttributionInput; last_touch?: AttributionInput } | null;
  answers?: Record<string, string>;
  formCode?: string;
  idempotencyKey?: string | null;
  source?: string;
  /** Canal de entrada. Un DM de Instagram no trae formulario ni landing:
   *  trae una identidad de Instagram y una conversacion ya empezada. */
  channel?: 'form' | 'instagram_dm' | 'manual';
  instagramUsername?: string | null;
  externalContactId?: string | null;
  conversationUrl?: string | null;
  /** A qué negocio entra. Por defecto, lanzamiento. */
  launchType?: 'launch' | 'evergreen';
};

export type CreateLeadResult = {
  leadId: string;
  publicId: string;
  created: boolean;          // false = ya existía y se ha reutilizado la ficha
  profileToken?: string;
};

/**
 * Alta desde formulario público.
 *
 * Idempotente por dos vías: la idempotency_key del submission y la
 * deduplicación por teléfono/email. Si la landing reintenta el POST porque
 * se le cayó la conexión, no aparecen dos Marcos Ruiz.
 */
export async function createLeadFromForm(input: CreateLeadInput): Promise<CreateLeadResult> {
  return db.transaction(async (tx) => {
    // 0. ¿Ya procesamos exactamente este envío?
    if (input.idempotencyKey) {
      const existing = await tx.select({ leadId: formSubmissions.leadId })
        .from(formSubmissions)
        .where(eq(formSubmissions.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing.length) {
        const lead = await tx.select().from(leads).where(eq(leads.id, existing[0].leadId)).limit(1);
        return { leadId: lead[0].id, publicId: lead[0].publicId, created: false };
      }
    }

    // Con Evergreen y Lanzamiento conviviendo, "el lanzamiento activo" ya no
    // es uno solo: hay que decir a cuál de los dos entra el lead.
    const wanted = input.launchType ?? 'launch';
    let launch = await tx.select().from(launches)
      .where(and(eq(launches.status, 'active'), eq(launches.type, wanted)))
      .orderBy(desc(launches.createdAt)).limit(1);
    if (!launch.length) {
      launch = await tx.select().from(launches)
        .where(eq(launches.status, 'active')).orderBy(desc(launches.createdAt)).limit(1);
    }
    if (!launch.length) throw new Error('NO_ACTIVE_LAUNCH: no hay lanzamiento activo.');
    const launchId = launch[0].id;

    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);

    // 1. ¿Existe ya esta persona?
    const match = await findExistingLead(tx, { phone: input.phone, email: input.email, name: input.fullName });

    let leadId: string;
    let publicId: string;
    let created = false;

    if (match.kind === 'exact') {
      leadId = match.leadId;
      const row = await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1);
      publicId = row[0].publicId;

      // Se completan huecos, nunca se pisa lo que ya había.
      await tx.update(leads).set({
        phoneRaw: row[0].phoneRaw ?? input.phone ?? null,
        phoneNormalized: row[0].phoneNormalized ?? phone,
        emailRaw: row[0].emailRaw ?? input.email ?? null,
        emailNormalized: row[0].emailNormalized ?? email,
        city: row[0].city ?? input.city ?? null,
        instagramUsername: row[0].instagramUsername ?? input.instagramUsername ?? null,
        externalContactId: row[0].externalContactId ?? input.externalContactId ?? null,
        conversationUrl: input.conversationUrl ?? row[0].conversationUrl,
        updatedAt: new Date(),
      }).where(eq(leads.id, leadId));
    } else {
      const seq = await tx.execute(sql`select nextval('lead_public_seq') as n`);
      const n = Number(firstRow<{ n: string | number }>(seq)?.n);
      if (!Number.isFinite(n)) throw new Error('SEQUENCE_UNAVAILABLE: lead_public_seq');
      publicId = `LD-${String(n).padStart(6, '0')}`;

      const inserted = await tx.insert(leads).values({
        launchId,
        publicId,
        fullName: input.fullName.trim(),
        phoneRaw: input.phone ?? null,
        phoneNormalized: phone,
        emailRaw: input.email ?? null,
        emailNormalized: email,
        city: input.city ?? null,
        status: 'new',
        channel: input.channel ?? 'form',
        instagramUsername: input.instagramUsername ?? null,
        externalContactId: input.externalContactId ?? null,
        conversationUrl: input.conversationUrl ?? null,
      }).returning({ id: leads.id });

      leadId = inserted[0].id;
      created = true;

      // 2. Atribución: se guarda una sola vez y ya no se toca (first-touch).
      const first = input.attribution?.first_touch;
      await tx.insert(leadAttribution).values({
        leadId,
        touch: 'first',
        source: input.source ?? inferSource(first),
        campaignId: first?.campaign_id ?? null,
        campaignName: first?.campaign_name ?? null,
        adsetId: first?.adset_id ?? null,
        adsetName: first?.adset_name ?? null,
        adId: first?.ad_id ?? null,
        adName: first?.ad_name ?? null,
        creativeId: first?.creative_id ?? null,
        placement: first?.placement ?? null,
        utmSource: first?.utm_source ?? null,
        utmMedium: first?.utm_medium ?? null,
        utmCampaign: first?.utm_campaign ?? null,
        utmContent: first?.utm_content ?? null,
        utmTerm: first?.utm_term ?? null,
        fbclid: first?.fbclid ?? null,
        fbp: first?._fbp ?? null,
        fbc: first?._fbc ?? null,
        landingUrl: first?.landing_url ?? null,
        referrerUrl: first?.referrer_url ?? null,
        rawParams: (first ?? {}) as Record<string, unknown>,
      });

      // 3. Asignación de setter.
      const setterId = await pickSetter(tx);
      if (setterId) await tx.update(leads).set({ assignedSetterId: setterId }).where(eq(leads.id, leadId));

      await logActivity(tx, {
        leadId, eventType: 'LEAD_CREATED',
        title: 'Lead registrado',
        description: describeSource(first),
        actorType: 'system',
      });
      await emit(tx, { eventType: 'lead.created', entityType: 'lead', entityId: leadId, leadId });
    }

    // 4. Duplicado dudoso: se anota para revisión, no se fusiona.
    if (match.kind === 'candidate') {
      await tx.insert(leadMergeCandidates).values({
        leadAId: match.leadId, leadBId: leadId,
        confidence: String(match.confidence), method: match.method,
        reasons: { note: 'Coincide el email pero el teléfono es distinto' },
      });
      await emit(tx, {
        eventType: 'lead.possible_duplicate_detected',
        entityType: 'lead', entityId: leadId, leadId,
        payload: { other: match.leadId, method: match.method },
      });
    }

    // 5. Respuestas del formulario.
    if (input.formCode && input.answers && Object.keys(input.answers).length) {
      await saveFormSubmission(tx, {
        leadId, formCode: input.formCode, answers: input.answers,
        idempotencyKey: input.idempotencyKey ?? null,
      });
    }

    // 6. Enlace identificado para el formulario de perfil.
    let profileToken: string | undefined;
    if (created) profileToken = await issueToken(tx, leadId, 'profile_form');

    return { leadId, publicId, created, profileToken };
  });
}

function inferSource(a?: AttributionInput): string {
  if (!a) return 'unknown';
  if (a.campaign_id || a.ad_id || a.fbclid) return 'meta';
  if (a.utm_source === 'meta' || a.utm_source === 'facebook' || a.utm_source === 'ig') return 'meta';
  if (a.utm_source) return String(a.utm_source);
  if (a.referrer_url) return 'organic';
  return 'direct';
}

function describeSource(a?: AttributionInput): string {
  if (!a) return 'Origen desconocido';
  const parts: string[] = [];
  if (a.utm_campaign || a.campaign_name) parts.push(`Campaña: ${a.campaign_name ?? a.utm_campaign}`);
  if (a.ad_name || a.ad_id) parts.push(`Anuncio: ${a.ad_name ?? a.ad_id}`);
  return parts.length ? parts.join(' · ') : 'Origen desconocido';
}

/* ── Respuestas de formulario ────────────────────────────────────────── */

export async function saveFormSubmission(
  tx: Tx,
  input: { leadId: string; formCode: string; answers: Record<string, string>; idempotencyKey?: string | null },
) {
  const form = await tx.select().from(forms).where(eq(forms.code, input.formCode)).limit(1);
  if (!form.length) throw new Error(`FORM_NOT_FOUND: ${input.formCode}`);

  const version = await tx.select().from(formVersions)
    .where(eq(formVersions.formId, form[0].id))
    .orderBy(desc(formVersions.version)).limit(1);
  if (!version.length) throw new Error(`FORM_VERSION_NOT_FOUND: ${input.formCode}`);

  const submission = await tx.insert(formSubmissions).values({
    formVersionId: version[0].id,
    leadId: input.leadId,
    source: 'landing',
    idempotencyKey: input.idempotencyKey ?? null,
  }).returning({ id: formSubmissions.id });

  const questions = await tx.select().from(formQuestions)
    .where(eq(formQuestions.formVersionId, version[0].id));

  for (const q of questions) {
    const answer = input.answers[q.code];
    if (answer === undefined || answer === '') continue;
    await tx.insert(formAnswers).values({
      submissionId: submission[0].id,
      questionId: q.id,
      // La pregunta EXACTA que vio el lead. Si mañana se reescribe,
      // esta respuesta sigue significando lo mismo.
      questionTextSnapshot: q.questionText,
      answerText: answer,
    });
  }

  await logActivity(tx, {
    leadId: input.leadId, eventType: 'FORM_SUBMITTED',
    title: input.formCode === 'REGISTRATION' ? 'Formulario de registro completado' : 'Formulario de perfil completado',
    actorType: 'system',
  });

  // El perfil completado es lo que mete al lead en la cola del setter.
  if (input.formCode === 'PRECLASS_PROFILE') {
    await tx.update(leads).set({ eligibleForSetter: true, updatedAt: new Date() })
      .where(eq(leads.id, input.leadId));
  }

  await emit(tx, {
    eventType: 'form.submitted', entityType: 'form_submission',
    entityId: submission[0].id, leadId: input.leadId,
    payload: { formCode: input.formCode },
  });

  return submission[0].id;
}
