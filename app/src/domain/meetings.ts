import { and, eq, sql, desc } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '@/db';
import {
  meetings, meetingScheduleHistory,
  leads, sales, payments, lossReasons, users, userRoles, launches, tasks,
} from '@/db/schema';
import { emit, logActivity, logAudit } from './events';
import { supersedeTasks, upsertSmartTask, completeTask } from './tasks';
import { applyAutomaticStatus, type LeadStatus } from './state';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ── Reserva desde Calendly ──────────────────────────────────────────── */

/**
 * Numeración por lead. Meeting #2 nunca sobrescribe la #1.
 * `SELECT ... FOR UPDATE` sobre el lead evita que dos webhooks simultáneos
 * pidan el mismo número y choquen contra el índice único.
 */
async function nextMeetingNumber(tx: Tx, leadId: string): Promise<number> {
  await tx.execute(sql`select id from leads where id = ${leadId} for update`);
  const row = await tx.select({ max: sql<number>`coalesce(max(${meetings.meetingNumber}), 0)` })
    .from(meetings).where(eq(meetings.leadId, leadId));
  return Number(row[0].max) + 1;
}

async function pickCloser(tx: Tx): Promise<string | null> {
  const rows = await tx.select({ id: users.id })
    .from(users).innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleCode, 'closer'), eq(users.active, true)))
    .orderBy(sql`${users.lastAssignedAt} nulls first`).limit(1);
  if (!rows.length) return null;
  await tx.update(users).set({ lastAssignedAt: new Date() }).where(eq(users.id, rows[0].id));
  return rows[0].id;
}

export async function bookMeeting(
  tx: Tx,
  input: {
    leadId: string;
    scheduledAt: Date;
    closerId?: string | null;
    externalProvider?: string | null;
    externalBookingId?: string | null;
    eventTypeId?: string | null;
    timezoneOriginal?: string | null;
    manualReviewRequired?: boolean;
  },
): Promise<{ meetingId: string; meetingNumber: number; created: boolean }> {
  // Idempotencia: Calendly reenvía el mismo evento. Sin esto, dos citas.
  if (input.externalBookingId) {
    const dupe = await tx.select().from(meetings)
      .where(and(
        eq(meetings.externalProvider, input.externalProvider ?? 'calendly'),
        eq(meetings.externalBookingId, input.externalBookingId),
      )).limit(1);
    if (dupe.length) {
      return { meetingId: dupe[0].id, meetingNumber: dupe[0].meetingNumber, created: false };
    }
  }

  const leadRow = await tx.select().from(leads).where(eq(leads.id, input.leadId)).limit(1);
  if (!leadRow.length) throw new Error('LEAD_NOT_FOUND');
  const lead = leadRow[0];

  const number = await nextMeetingNumber(tx, input.leadId);
  const closerId = input.closerId ?? lead.assignedCloserId ?? await pickCloser(tx);

  const inserted = await tx.insert(meetings).values({
    leadId: input.leadId,
    closerId,
    launchId: lead.launchId,
    meetingNumber: number,
    externalProvider: input.externalProvider ?? null,
    externalBookingId: input.externalBookingId ?? null,
    eventTypeId: input.eventTypeId ?? null,
    timezoneOriginal: input.timezoneOriginal ?? null,
    scheduledAt: input.scheduledAt,
    status: 'scheduled',
    commercialResult: 'pending',
    confirmation24hStatus: 'pending',
    manualReviewRequired: input.manualReviewRequired ?? false,
  }).returning({ id: meetings.id });

  await tx.update(leads).set({
    assignedCloserId: closerId,
    status: applyAutomaticStatus(lead.status as LeadStatus, 'meeting_scheduled'),
    nextActionType: 'meeting',
    nextActionAt: input.scheduledAt,
    updatedAt: new Date(),
  }).where(eq(leads.id, input.leadId));

  await logActivity(tx, {
    leadId: input.leadId, eventType: 'MEETING_BOOKED',
    title: `Reunión #${number} agendada`,
    actorType: 'integration',
    metadata: { scheduledAt: input.scheduledAt.toISOString() },
  });

  await emit(tx, {
    eventType: 'meeting.booked', entityType: 'meeting',
    entityId: inserted[0].id, leadId: input.leadId,
    actorType: 'integration',
    payload: { meetingNumber: number },
  });

  return { meetingId: inserted[0].id, meetingNumber: number, created: true };
}

/* ── Reagendar ───────────────────────────────────────────────────────── */

/**
 * NO se crea una reunión nueva. Se mueve la hora y se deja rastro.
 *
 * Crear una segunda reunión por un cambio de hora inflaría el show_rate:
 * contaría dos citas esperadas donde solo hubo una.
 */
export async function rescheduleMeeting(
  tx: Tx,
  input: { meetingId: string; newScheduledAt: Date; reason?: string; userId?: string | null; actorType?: 'user' | 'integration' },
) {
  const rows = await tx.select().from(meetings).where(eq(meetings.id, input.meetingId)).limit(1);
  if (!rows.length) throw new Error('MEETING_NOT_FOUND');
  const m = rows[0];

  await tx.insert(meetingScheduleHistory).values({
    meetingId: m.id,
    oldScheduledAt: m.scheduledAt,
    newScheduledAt: input.newScheduledAt,
    reason: input.reason ?? null,
    changedBy: input.userId ?? null,
    actorType: input.actorType ?? 'user',
  });

  await tx.update(meetings).set({
    scheduledAt: input.newScheduledAt,
    status: 'scheduled',
    confirmation24hStatus: 'pending',    // la confirmación anterior ya no vale
    updatedAt: new Date(),
  }).where(eq(meetings.id, m.id));

  // La tarea de confirmación vieja apunta a una hora que ya no existe.
  // Dejarla viva hace que el setter llame para confirmar una cita equivocada.
  await supersedeTasks(tx, { meetingId: m.id, taskTypes: ['confirm_meeting_24h'] },
    'Reunión reagendada: la confirmación anterior queda obsoleta.');

  await tx.update(leads).set({ nextActionAt: input.newScheduledAt, updatedAt: new Date() })
    .where(eq(leads.id, m.leadId));

  await logActivity(tx, {
    leadId: m.leadId, eventType: 'MEETING_RESCHEDULED',
    title: `Reunión #${m.meetingNumber} reagendada`,
    description: input.reason ?? null,
    actorType: input.actorType ?? 'user', actorUserId: input.userId ?? null,
  });

  await emit(tx, {
    eventType: 'meeting.rescheduled', entityType: 'meeting',
    entityId: m.id, leadId: m.leadId,
    payload: { from: m.scheduledAt.toISOString(), to: input.newScheduledAt.toISOString() },
  });
}

export async function cancelMeeting(
  tx: Tx, meetingId: string, reason?: string, userId?: string | null,
) {
  const rows = await tx.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!rows.length) return;
  const m = rows[0];

  await tx.update(meetings).set({
    status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date(),
  }).where(eq(meetings.id, meetingId));

  await supersedeTasks(tx, { meetingId, taskTypes: ['confirm_meeting_24h', 'meeting_result'] },
    'Reunión cancelada.');

  await logActivity(tx, {
    leadId: m.leadId, eventType: 'MEETING_CANCELLED',
    title: `Reunión #${m.meetingNumber} cancelada`, description: reason ?? null,
    actorUserId: userId ?? null,
  });

  await emit(tx, {
    eventType: 'meeting.cancelled', entityType: 'meeting', entityId: meetingId, leadId: m.leadId,
  });
}

/* ── Confirmación 24 h ───────────────────────────────────────────────── */

export async function applyConfirmation24h(
  tx: Tx, meetingId: string,
  status: 'confirmed' | 'reschedule_requested' | 'cancelled' | 'uncertain' | 'no_answer',
  userId: string,
) {
  await tx.update(meetings).set({ confirmation24hStatus: status, updatedAt: new Date() })
    .where(eq(meetings.id, meetingId));

  if (status === 'cancelled') await cancelMeeting(tx, meetingId, 'Cancelada en la confirmación 24 h', userId);

  await emit(tx, {
    eventType: 'meeting.confirmation_updated', entityType: 'meeting',
    entityId: meetingId, actorType: 'user', actorUserId: userId, payload: { status },
  });
}

/* ── Resultado de la reunión ─────────────────────────────────────────── */

export type MeetingResultInput = {
  meetingId: string;
  userId: string;
  result: 'won' | 'lost' | 'follow_up' | 'no_show';
  notes?: string | null;
  phantomUrl?: string | null;
  // won
  amountCents?: number;
  paymentMethod?: string;
  financingStatus?: string;
  financingProvider?: string | null;
  installments?: number | null;
  // lost
  lossReasonCode?: string;
  lossReasonNotes?: string | null;
  // follow_up
  followUpReason?: string;
  followUpAt?: Date;
  nextAction?: string;
  createSecondMeeting?: boolean;
};

/**
 * Todo el cierre en UNA transacción.
 *
 * El estado a medias que esto evita: venta creada pero el lead sigue en
 * seguimiento, o revenue sumado dos veces porque el closer pulsó dos veces.
 */
export async function saveMeetingResult(input: MeetingResultInput) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(meetings).where(eq(meetings.id, input.meetingId)).limit(1);
    if (!rows.length) throw new Error('MEETING_NOT_FOUND');
    const m = rows[0];

    const leadRow = await tx.select().from(leads).where(eq(leads.id, m.leadId)).limit(1);
    const lead = leadRow[0];

    validateResult(input);

    const patch: Record<string, unknown> = {
      notes: input.notes ?? m.notes,
      phantomUrl: input.phantomUrl ?? m.phantomUrl,
      updatedAt: new Date(),
    };

    /* ── NO-SHOW ─────────────────────────────────────────────────────
     * Estado OPERATIVO, no pérdida comercial. Un no-show se reagenda.
     * Marcarlo perdido automáticamente destruye leads recuperables y
     * ensucia el close rate.
     */
    if (input.result === 'no_show') {
      patch.status = 'no_show';
      patch.noShowMarkedAt = new Date();
      await tx.update(meetings).set(patch).where(eq(meetings.id, m.id));

      await upsertSmartTask(tx, {
        dedupeKey: `noshow_recovery:${m.id}`,
        title: `Recuperar no-show · ${lead.fullName}`,
        reason: 'El lead no apareció. Contactar para reagendar antes de darlo por perdido.',
        taskType: 'follow_up',
        assigneeId: lead.assignedSetterId ?? m.closerId,
        dueAt: new Date(Date.now() + 2 * 3600_000),
        priority: 'high',
        launchId: m.launchId, relatedLeadId: m.leadId, relatedMeetingId: m.id,
        ruleCode: 'NO_SHOW_RECOVERY',
      });

      await logActivity(tx, {
        leadId: m.leadId, eventType: 'MEETING_NO_SHOW',
        title: `Reunión #${m.meetingNumber}: no-show`,
        actorType: 'user', actorUserId: input.userId,
      });
      await emit(tx, {
        eventType: 'meeting.no_show', entityType: 'meeting', entityId: m.id, leadId: m.leadId,
        actorType: 'user', actorUserId: input.userId,
      });
      return { ok: true };
    }

    // A partir de aquí la reunión sí se celebró.
    patch.status = 'completed';
    patch.commercialResult = input.result;
    patch.endedAt = m.endedAt ?? new Date();

    /* ── GANADO ─────────────────────────────────────────────────────── */
    if (input.result === 'won') {
      // Idempotencia: doble click no puede crear dos ventas.
      const key = createHash('sha256')
        .update(`sale:${m.id}:${input.amountCents}`).digest('hex').slice(0, 40);

      const sale = await tx.insert(sales).values({
        leadId: m.leadId, meetingId: m.id, closerId: input.userId, launchId: m.launchId,
        amountCents: input.amountCents!,
        paymentMethod: input.paymentMethod!,
        financingStatus: input.financingStatus ?? 'not_applicable',
        financingProvider: input.financingProvider ?? null,
        installments: input.installments ?? null,
        installmentCents: input.installments ? Math.round(input.amountCents! / input.installments) : null,
        closedAt: new Date(),
        idempotencyKey: key,
      }).onConflictDoNothing({ target: sales.idempotencyKey }).returning({ id: sales.id });

      if (sale.length && input.installments && input.installments > 1) {
        const per = Math.round(input.amountCents! / input.installments);
        for (let i = 1; i <= input.installments; i++) {
          const due = new Date();
          due.setMonth(due.getMonth() + (i - 1));
          await tx.insert(payments).values({
            saleId: sale[0].id,
            amountCents: i === input.installments
              ? input.amountCents! - per * (input.installments - 1)   // el redondeo va a la última
              : per,
            status: i === 1 ? 'paid' : 'pending',
            dueAt: due,
            paidAt: i === 1 ? new Date() : null,
            installmentNumber: i,
          });
        }
      }

      // revenue del lead: SIEMPRE derivado de sales. Nunca escrito a mano.
      const total = await tx.select({ sum: sql<number>`coalesce(sum(${sales.amountCents}), 0)` })
        .from(sales).where(and(eq(sales.leadId, m.leadId), eq(sales.status, 'active')));

      await tx.update(leads).set({
        status: 'won', wonAt: new Date(),
        revenueCents: Number(total[0].sum),
        nextActionType: null, nextActionAt: null,
        updatedAt: new Date(),
      }).where(eq(leads.id, m.leadId));

      await supersedeTasks(tx, { leadId: m.leadId, taskTypes: ['follow_up', 'confirm_live', 'call_1', 'call_1_retry'] },
        'Lead cerrado como ganado.');

      await logActivity(tx, {
        leadId: m.leadId, eventType: 'SALE_CREATED',
        title: `Venta cerrada · reunión #${m.meetingNumber}`,
        description: `${(input.amountCents! / 100).toFixed(0)} € · ${input.paymentMethod}`,
        actorType: 'user', actorUserId: input.userId,
      });
      await logAudit(tx, {
        actorUserId: input.userId, action: 'sale.created',
        entityType: 'meeting', entityId: m.id,
        oldValues: { commercialResult: m.commercialResult },
        newValues: { commercialResult: 'won', amountCents: input.amountCents },
      });
      await emit(tx, {
        eventType: 'sale.won', entityType: 'meeting', entityId: m.id, leadId: m.leadId,
        actorType: 'user', actorUserId: input.userId,
        payload: { amountCents: input.amountCents },
      });
    }

    /* ── PERDIDO ────────────────────────────────────────────────────── */
    if (input.result === 'lost') {
      const reason = await tx.select().from(lossReasons)
        .where(eq(lossReasons.code, input.lossReasonCode!)).limit(1);
      if (!reason.length) throw new Error('MOTIVO_INVALIDO');

      patch.lossReasonId = reason[0].id;
      patch.lossReasonNotes = input.lossReasonNotes ?? null;

      await tx.update(leads).set({
        status: 'lost', lostAt: new Date(),
        nextActionType: null, nextActionAt: null, updatedAt: new Date(),
      }).where(eq(leads.id, m.leadId));

      await supersedeTasks(tx, { leadId: m.leadId, taskTypes: ['follow_up', 'confirm_live'] },
        'Lead cerrado como perdido.');

      await logActivity(tx, {
        leadId: m.leadId, eventType: 'MEETING_LOST',
        title: `Reunión #${m.meetingNumber}: perdida`,
        description: `Motivo: ${reason[0].label}`,
        actorType: 'user', actorUserId: input.userId,
      });
      // La ficha NO se borra: sirve para análisis y para recuperación futura.
    }

    /* ── SEGUIMIENTO ────────────────────────────────────────────────── */
    if (input.result === 'follow_up') {
      patch.followUpReason = input.followUpReason;
      patch.followUpAt = input.followUpAt;
      patch.nextAction = input.nextAction;

      await tx.update(leads).set({
        status: applyAutomaticStatus(lead.status as LeadStatus, 'follow_up'),
        nextActionType: input.nextAction ?? 'follow_up',
        nextActionAt: input.followUpAt ?? null,
        updatedAt: new Date(),
      }).where(eq(leads.id, m.leadId));

      if (input.createSecondMeeting && input.followUpAt) {
        // Meeting #N+1. La #1 no se toca: cada reunión conserva su
        // transcripción, sus notas y su resultado.
        await bookMeeting(tx, {
          leadId: m.leadId, scheduledAt: input.followUpAt, closerId: m.closerId,
        });
      } else {
        await upsertSmartTask(tx, {
          dedupeKey: `follow_up:${m.id}`,
          title: `Seguimiento · ${lead.fullName}`,
          reason: input.followUpReason ?? 'Seguimiento acordado en la reunión.',
          taskType: 'follow_up',
          assigneeId: m.closerId,
          dueAt: input.followUpAt ?? null,
          priority: 'high',
          launchId: m.launchId, relatedLeadId: m.leadId, relatedMeetingId: m.id,
          ruleCode: 'FOLLOW_UP_FROM_MEETING',
        });
      }

      await logActivity(tx, {
        leadId: m.leadId, eventType: 'FOLLOW_UP_CREATED',
        title: `Reunión #${m.meetingNumber}: seguimiento`,
        description: input.followUpReason ?? null,
        actorType: 'user', actorUserId: input.userId,
      });
      await emit(tx, {
        eventType: 'meeting.follow_up_created', entityType: 'meeting',
        entityId: m.id, leadId: m.leadId, actorType: 'user', actorUserId: input.userId,
      });
    }

    await tx.update(meetings).set(patch).where(eq(meetings.id, m.id));

    const pend = await tx.select({ id: tasks.id }).from(tasks)
      .where(and(
        eq(tasks.relatedMeetingId, m.id),
        eq(tasks.taskType, 'meeting_result'),
        eq(tasks.status, 'pending'),
      ));
    for (const t of pend) await completeTask(tx, t.id, input.userId, input.result);

    await emit(tx, {
      eventType: 'meeting.completed', entityType: 'meeting', entityId: m.id, leadId: m.leadId,
      actorType: 'user', actorUserId: input.userId, payload: { result: input.result },
    });

    return { ok: true };
  });
}

/** Validaciones de servidor. Cada una tapa un agujero real de datos. */
function validateResult(i: MeetingResultInput) {
  if (i.result === 'won') {
    if (!i.amountCents || i.amountCents <= 0) throw new Error('FALTA_IMPORTE: una venta necesita importe.');
    if (!i.paymentMethod) throw new Error('FALTA_METODO_PAGO: indica cómo paga.');
  }
  if (i.result === 'lost' && !i.lossReasonCode) {
    // Sin motivo obligatorio no hay analítica de pérdidas posible.
    throw new Error('FALTA_MOTIVO: perder exige elegir un motivo.');
  }
  if (i.result === 'follow_up') {
    if (!i.followUpReason) throw new Error('FALTA_MOTIVO: indica por qué queda en seguimiento.');
    // Un seguimiento sin fecha es un lead olvidado con otro nombre.
    if (!i.followUpAt) throw new Error('FALTA_FECHA: un seguimiento necesita fecha de próxima acción.');
    if (!i.nextAction) throw new Error('FALTA_ACCION: indica cuál es la próxima acción.');
  }
}

/* ── Consultas ───────────────────────────────────────────────────────── */

export async function meetingsForLead(leadId: string) {
  return db.select().from(meetings)
    .where(eq(meetings.leadId, leadId))
    .orderBy(desc(meetings.meetingNumber));
}

export async function activeLaunchId(): Promise<string> {
  const rows = await db.select().from(launches)
    .where(eq(launches.status, 'active')).orderBy(desc(launches.createdAt)).limit(1);
  if (!rows.length) throw new Error('NO_ACTIVE_LAUNCH');
  return rows[0].id;
}
