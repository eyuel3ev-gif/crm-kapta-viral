import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, firstRow } from '@/db';
import { leads, users, userRoles, launches, webhookEvents } from '@/db/schema';
import { normalizePhone, normalizeEmail } from '@/lib/phone';
import { emit, logActivity } from '@/domain/events';
import { upsertSmartTask } from '@/domain/tasks';

/**
 * Conversaciones de Instagram, vía ManyChat.
 *
 * DECISIÓN IMPORTANTE: el CRM **no duplica la bandeja de entrada**.
 *
 * Replicar los mensajes de Instagram dentro de la aplicación exige la
 * Instagram Messaging API de Meta, con revisión de app y el permiso
 * `instagram_manage_messages`. Son semanas de trabajo y una aprobación que
 * puede no llegar — y aun consiguiéndolo, tendríamos una bandeja peor que la
 * de Instagram, con la que nadie querría trabajar.
 *
 * Lo que sí resuelve el problema real: ManyChat empuja aquí el contacto, el
 * CRM crea la ficha, la asigna a un setter y le abre la tarea; el setter
 * responde donde de verdad está la conversación, con un enlace directo. El
 * CRM es dueño de la asignación y del embudo, no del chat.
 *
 * Configuración en ManyChat — acción "External Request":
 *   Method   POST
 *   URL      https://TU-DOMINIO/api/webhooks/manychat
 *   Headers  x-crm-token: <MANYCHAT_WEBHOOK_TOKEN>
 *   Body     { "contact_id": "{{contact_id}}", "name": "{{first_name}} {{last_name}}",
 *              "ig_username": "{{ig_username}}", "phone": "{{phone}}",
 *              "email": "{{email}}" }
 */

export const runtime = 'nodejs';

const Body = z.object({
  contact_id: z.string().min(1),
  name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  ig_username: z.string().optional(),
  instagram_username: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  conversation_url: z.string().optional(),
  /** Email del setter al que forzar la asignación. Sin esto, round-robin. */
  assign_to: z.string().optional(),
  /** Texto libre: primer mensaje, respuesta a una pregunta, etiqueta… */
  note: z.string().optional(),
}).passthrough();

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-crm-token');
  if (!process.env.MANYCHAT_WEBHOOK_TOKEN || token !== process.env.MANYCHAT_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: { code: 'INVALID_JSON' } }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', details: parsed.error.flatten() } }, { status: 400 });
  }
  const b = parsed.data;

  const igUser = (b.ig_username ?? b.instagram_username ?? '').replace(/^@/, '').trim() || null;
  const fullName = (b.name ?? [b.first_name, b.last_name].filter(Boolean).join(' ')).trim()
    || (igUser ? `@${igUser}` : 'Contacto de Instagram');

  await db.insert(webhookEvents).values({
    provider: 'manychat',
    externalEventId: b.contact_id,
    eventType: 'contact',
    payload: raw as Record<string, unknown>,
    status: 'processing',
  }).onConflictDoUpdate({
    target: [webhookEvents.provider, webhookEvents.externalEventId],
    set: { payload: raw as Record<string, unknown>, status: 'processing' },
  });

  try {
    const result = await db.transaction(async (tx) => {
      // Un DM de Instagram es Evergreen: no viene de ninguna clase.
      let launch = await tx.select().from(launches)
        .where(and(eq(launches.status, 'active'), eq(launches.type, 'evergreen'))).limit(1);
      if (!launch.length) {
        launch = await tx.select().from(launches).where(eq(launches.status, 'active')).limit(1);
      }
      if (!launch.length) throw new Error('NO_ACTIVE_LAUNCH');

      // El mismo suscriptor que vuelve a escribir cae en su ficha.
      const existing = await tx.select().from(leads)
        .where(eq(leads.externalContactId, b.contact_id)).limit(1);

      const conversationUrl = b.conversation_url
        ?? (igUser ? `https://www.instagram.com/${igUser}/` : null);

      if (existing.length) {
        const lead = existing[0];
        await tx.update(leads).set({
          instagramUsername: lead.instagramUsername ?? igUser,
          phoneRaw: lead.phoneRaw ?? b.phone ?? null,
          phoneNormalized: lead.phoneNormalized ?? normalizePhone(b.phone),
          emailRaw: lead.emailRaw ?? b.email ?? null,
          emailNormalized: lead.emailNormalized ?? normalizeEmail(b.email),
          conversationUrl: conversationUrl ?? lead.conversationUrl,
          updatedAt: new Date(),
        }).where(eq(leads.id, lead.id));

        if (b.note) {
          await logActivity(tx, {
            leadId: lead.id, eventType: 'INSTAGRAM_MESSAGE',
            title: 'Nuevo mensaje en Instagram', description: b.note,
            actorType: 'integration',
          });
        }
        return { leadId: lead.id, publicId: lead.publicId, created: false, setterId: lead.assignedSetterId };
      }

      const setterId = await pickSetter(tx, b.assign_to);

      const seq = await tx.execute(sql`select nextval('lead_public_seq') as n`);
      const n = Number(firstRow<{ n: string | number }>(seq)?.n);
      if (!Number.isFinite(n)) throw new Error('SEQUENCE_UNAVAILABLE');
      const publicId = `LD-${String(n).padStart(6, '0')}`;

      const inserted = await tx.insert(leads).values({
        launchId: launch[0].id,
        publicId,
        fullName,
        phoneRaw: b.phone ?? null,
        phoneNormalized: normalizePhone(b.phone),
        emailRaw: b.email ?? null,
        emailNormalized: normalizeEmail(b.email),
        channel: 'instagram_dm',
        instagramUsername: igUser,
        externalContactId: b.contact_id,
        conversationUrl,
        assignedSetterId: setterId,
        // Un DM entrante ya es una conversación abierta: entra directo en la
        // cola del setter, sin esperar a ningún formulario de perfil.
        eligibleForSetter: true,
        contactStatus: 'contacted',
        status: 'contacted',
      }).returning({ id: leads.id });

      const leadId = inserted[0].id;

      await logActivity(tx, {
        leadId, eventType: 'LEAD_CREATED',
        title: 'Conversación iniciada en Instagram',
        description: igUser ? `@${igUser}` : null,
        actorType: 'integration',
      });
      if (b.note) {
        await logActivity(tx, {
          leadId, eventType: 'INSTAGRAM_MESSAGE',
          title: 'Primer mensaje', description: b.note, actorType: 'integration',
        });
      }

      if (setterId) {
        await upsertSmartTask(tx, {
          dedupeKey: `ig_conversation:${b.contact_id}`,
          title: `Atender conversación · ${fullName}`,
          reason: 'Conversación abierta en Instagram sin responder.',
          taskType: 'manual',
          assigneeId: setterId,
          dueAt: new Date(Date.now() + 30 * 60_000),
          priority: 'high',
          launchId: launch[0].id,
          relatedLeadId: leadId,
          ruleCode: 'INSTAGRAM_CONVERSATION',
        });
      }

      await emit(tx, {
        eventType: 'lead.created', entityType: 'lead', entityId: leadId,
        leadId, actorType: 'integration', payload: { channel: 'instagram_dm' },
      });

      return { leadId, publicId, created: true, setterId };
    });

    await db.update(webhookEvents)
      .set({ status: 'processed', processedAt: new Date() })
      .where(and(
        eq(webhookEvents.provider, 'manychat'),
        eq(webhookEvents.externalEventId, b.contact_id),
      ));

    return NextResponse.json({ data: result }, { status: result.created ? 201 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[manychat]', message);
    await db.update(webhookEvents).set({ status: 'failed', errorMessage: message })
      .where(and(
        eq(webhookEvents.provider, 'manychat'),
        eq(webhookEvents.externalEventId, b.contact_id),
      ));
    return NextResponse.json({ error: { code: 'PROCESSING_FAILED', message } }, { status: 500 });
  }
}

/**
 * A quién se asigna. Si ManyChat manda `assign_to`, manda eso; si no,
 * round-robin entre los setters activos. Con un solo setter siempre sale él,
 * y el día que entre otro no hay que tocar nada.
 */
async function pickSetter(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  assignTo?: string,
): Promise<string | null> {
  if (assignTo) {
    const explicit = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.email, assignTo.toLowerCase().trim()), eq(users.active, true)))
      .limit(1);
    if (explicit.length) return explicit[0].id;
  }

  const candidates = await tx.select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleCode, 'setter'), eq(users.active, true)))
    .orderBy(sql`${users.lastAssignedAt} nulls first`)
    .limit(1);

  if (!candidates.length) return null;
  await tx.update(users).set({ lastAssignedAt: new Date() }).where(eq(users.id, candidates[0].id));
  return candidates[0].id;
}
