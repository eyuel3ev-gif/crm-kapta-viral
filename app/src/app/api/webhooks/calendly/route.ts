import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { webhookEvents, leads, meetings } from '@/db/schema';
import { findExistingLead, createLeadFromForm } from '@/domain/leads';
import { bookMeeting, rescheduleMeeting, cancelMeeting } from '@/domain/meetings';
import { normalizePhone, normalizeEmail } from '@/lib/phone';

/**
 * Webhook de Calendly.
 *
 * Dos cosas que este handler no puede hacer nunca:
 *
 *  1. Crear dos reuniones por el mismo evento. Calendly reenvía cuando no
 *     recibe 2xx a tiempo, y sin la clave única acabaríamos con citas
 *     duplicadas y un show rate inventado.
 *
 *  2. Fusionar dos personas por parecido de nombre. Es preferible un
 *     duplicado que alguien pueda revisar a mezclar dos fichas: lo primero
 *     se arregla, lo segundo no.
 */

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifySignature(req.headers.get('calendly-webhook-signature'), raw)) {
    return NextResponse.json({ error: { code: 'INVALID_SIGNATURE' } }, { status: 401 });
  }

  let payload: CalendlyPayload;
  try { payload = JSON.parse(raw); }
  catch { return NextResponse.json({ error: { code: 'INVALID_JSON' } }, { status: 400 }); }

  const externalEventId =
    payload.payload?.uri ?? payload.payload?.invitee?.uri ?? `${payload.event}:${Date.now()}`;

  // Idempotencia. Si el evento ya se procesó, se responde OK sin repetir nada.
  const existing = await db.select().from(webhookEvents)
    .where(and(
      eq(webhookEvents.provider, 'calendly'),
      eq(webhookEvents.externalEventId, externalEventId),
    )).limit(1);

  if (existing.length && existing[0].status === 'processed') {
    return NextResponse.json({ data: { ok: true, duplicate: true } });
  }

  const [evt] = existing.length
    ? existing
    : await db.insert(webhookEvents).values({
        provider: 'calendly',
        externalEventId,
        eventType: payload.event,
        payload: payload as unknown as Record<string, unknown>,
        status: 'processing',
      }).returning();

  try {
    await handleEvent(payload);
    await db.update(webhookEvents)
      .set({ status: 'processed', processedAt: new Date() })
      .where(eq(webhookEvents.id, evt.id));
    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[calendly]', message);
    // El evento NO se pierde: queda en failed y se reintenta o se revisa.
    await db.update(webhookEvents).set({
      status: 'failed', errorMessage: message,
      retryCount: (evt.retryCount ?? 0) + 1,
    }).where(eq(webhookEvents.id, evt.id));
    return NextResponse.json({ error: { code: 'PROCESSING_FAILED' } }, { status: 500 });
  }
}

async function handleEvent(payload: CalendlyPayload) {
  const p = payload.payload;
  const inviteeName = p?.name ?? p?.invitee?.name ?? 'Sin nombre';
  const inviteeEmail = p?.email ?? p?.invitee?.email ?? null;
  const phone = extractPhone(p);
  const startsAt = p?.scheduled_event?.start_time ?? p?.event?.start_time;
  const bookingId = p?.uri ?? p?.invitee?.uri ?? null;

  if (payload.event === 'invitee.canceled') {
    if (!bookingId) return;
    const found = await db.select().from(meetings)
      .where(and(
        eq(meetings.externalProvider, 'calendly'),
        eq(meetings.externalBookingId, bookingId),
      )).limit(1);
    if (found.length) {
      await db.transaction(async (tx) => {
        await cancelMeeting(tx, found[0].id, 'Cancelada desde Calendly', null);
      });
    }
    return;
  }

  if (!startsAt) throw new Error('MISSING_START_TIME');
  const scheduledAt = new Date(startsAt);

  // Reprogramación: se mueve la hora de la reunión existente, no se crea otra.
  const rescheduledFrom = p?.old_invitee ?? p?.rescheduled_from;
  if (rescheduledFrom) {
    const prior = await db.select().from(meetings)
      .where(and(
        eq(meetings.externalProvider, 'calendly'),
        eq(meetings.externalBookingId, String(rescheduledFrom)),
      )).limit(1);
    if (prior.length) {
      await db.transaction(async (tx) => {
        await rescheduleMeeting(tx, {
          meetingId: prior[0].id, newScheduledAt: scheduledAt,
          reason: 'Reprogramada desde Calendly', actorType: 'integration',
        });
      });
      return;
    }
  }

  // Matching conservador: teléfono exacto, luego email exacto. Nada más.
  const match = await findExistingLead(db, {
    phone, email: inviteeEmail, name: inviteeName,
  });

  let leadId: string;
  let needsReview = false;

  if (match.kind === 'exact') {
    leadId = match.leadId;
  } else {
    // Nadie encaja con seguridad: se crea ficha marcada para revisión, en
    // lugar de adivinar. El closer no puede quedarse sin la reunión.
    const created = await createLeadFromForm({
      fullName: inviteeName,
      phone, email: inviteeEmail,
      source: 'calendly_unmatched',
      idempotencyKey: `calendly:${bookingId}`,
    });
    leadId = created.leadId;
    needsReview = true;
  }

  await db.transaction(async (tx) => {
    await bookMeeting(tx, {
      leadId,
      scheduledAt,
      externalProvider: 'calendly',
      externalBookingId: bookingId,
      eventTypeId: p?.scheduled_event?.event_type ?? null,
      timezoneOriginal: p?.timezone ?? null,
      manualReviewRequired: needsReview,
    });
  });
}

function extractPhone(p: CalendlyPayload['payload']): string | null {
  const direct = p?.text_reminder_number ?? p?.invitee?.text_reminder_number;
  if (direct) return normalizePhone(direct);

  // Calendly manda los campos personalizados como preguntas y respuestas.
  for (const q of p?.questions_and_answers ?? []) {
    const label = (q.question ?? '').toLowerCase();
    if (label.includes('tel') || label.includes('whatsapp') || label.includes('móvil') || label.includes('movil')) {
      const n = normalizePhone(q.answer);
      if (n) return n;
    }
  }
  return null;
}

function verifySignature(header: string | null, body: string): boolean {
  const key = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  // Sin clave configurada solo se acepta fuera de producción, para poder
  // probar con webhooks reales durante el desarrollo.
  if (!key) return process.env.NODE_ENV !== 'production';
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=').map((s) => s.trim())),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return false;

  const expected = createHmac('sha256', key).update(`${parts.t}.${body}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

type CalendlyPayload = {
  event: string;
  payload?: {
    uri?: string;
    name?: string;
    email?: string;
    timezone?: string;
    text_reminder_number?: string;
    rescheduled_from?: string;
    old_invitee?: string;
    questions_and_answers?: { question?: string; answer: string }[];
    invitee?: { uri?: string; name?: string; email?: string; text_reminder_number?: string };
    scheduled_event?: { start_time?: string; event_type?: string };
    event?: { start_time?: string };
  };
};
