import { and, eq, desc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import {
  setterCalls, setterCallAnswers, setterCallQuestions,
  leads, automationSettings, tasks,
} from '@/db/schema';
import { emit, logActivity } from './events';
import { upsertSmartTask, completeTask, type Priority } from './tasks';
import { applyAutomaticStatus, type LeadStatus } from './state';
import { label, CALL_TYPE } from '@/lib/labels';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CallType = 'post_class_1' | 'webinar_confirmation' | 'meeting_24h';

type RetryPolicy = {
  max_attempts: number;
  first_retry_minutes: number;
  second_retry_strategy: 'next_day' | 'hours';
  second_retry_hour: number;
};

const DEFAULT_POLICY: RetryPolicy = {
  max_attempts: 3, first_retry_minutes: 180,
  second_retry_strategy: 'next_day', second_retry_hour: 11,
};

async function getRetryPolicy(tx: Tx): Promise<RetryPolicy> {
  const row = await tx.select().from(automationSettings)
    .where(eq(automationSettings.key, 'setter_retry_policy')).limit(1);
  return { ...DEFAULT_POLICY, ...(row[0]?.valueJson as Partial<RetryPolicy> ?? {}) };
}

/* ── Crear la llamada ────────────────────────────────────────────────── */

export async function scheduleCall(
  tx: Tx,
  input: {
    leadId: string; setterId: string; launchId: string;
    callType: CallType; scheduledAt: Date;
    meetingId?: string | null;
    priority?: Priority;
    dedupeKey: string;
    reason: string;
    leadName: string;
  },
): Promise<string> {
  const callGroupId = randomUUID();

  const call = await tx.insert(setterCalls).values({
    leadId: input.leadId,
    setterId: input.setterId,
    launchId: input.launchId,
    callType: input.callType,
    callGroupId,
    attemptNumber: 1,
    meetingId: input.meetingId ?? null,
    scheduledAt: input.scheduledAt,
    status: 'scheduled',
  }).returning({ id: setterCalls.id });

  await upsertSmartTask(tx, {
    dedupeKey: input.dedupeKey,
    title: `${label(CALL_TYPE, input.callType)} · ${input.leadName}`,
    reason: input.reason,
    taskType: input.callType === 'post_class_1' ? 'call_1'
      : input.callType === 'webinar_confirmation' ? 'confirm_live'
      : 'confirm_meeting_24h',
    assigneeId: input.setterId,
    dueAt: input.scheduledAt,
    priority: input.priority ?? 'high',
    launchId: input.launchId,
    relatedLeadId: input.leadId,
    relatedMeetingId: input.meetingId ?? null,
    relatedSetterCallId: call[0].id,
    ruleCode: `SCHEDULE_${input.callType.toUpperCase()}`,
  });

  await emit(tx, {
    eventType: 'setter_call.scheduled', entityType: 'setter_call',
    entityId: call[0].id, leadId: input.leadId,
  });

  return call[0].id;
}

/* ── No contesta ─────────────────────────────────────────────────────── */

/**
 * "No coge" tiene que ser una acción ATÓMICA: el setter pulsa un botón y el
 * sistema guarda el intento, escribe el historial, evalúa la política de
 * reintentos y crea UNA sola tarea futura. Si el setter tuviera que crearse
 * la tarea a mano, la mitad de los reintentos no existirían.
 *
 * Regla que no se rompe: no contestar NO descalifica. Son dos preguntas
 * distintas — "¿he podido hablar con él?" y "¿es buen lead?" — y mezclarlas
 * hace imposible saber si el tráfico es malo o si llamamos a mala hora.
 */
export async function registerNoAnswer(
  input: { callId: string; userId: string },
): Promise<{ retryScheduled: boolean; nextAt: Date | null; attempt: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(setterCalls)
      .where(eq(setterCalls.id, input.callId)).limit(1);
    if (!rows.length) throw new Error('CALL_NOT_FOUND');
    const call = rows[0];

    if (call.status === 'completed') {
      throw new Error('CALL_ALREADY_COMPLETED: esta llamada ya tiene resultado.');
    }

    const lead = await tx.select().from(leads).where(eq(leads.id, call.leadId)).limit(1);
    const policy = await getRetryPolicy(tx);

    // 1. Se cierra el intento actual. NUNCA se sobrescribe el anterior.
    await tx.update(setterCalls).set({
      status: 'completed', answered: false, resultCode: 'no_answer',
      completedAt: new Date(), updatedAt: new Date(),
    }).where(eq(setterCalls.id, call.id));

    await tx.update(leads).set({
      contactStatus: 'attempted', updatedAt: new Date(),
    }).where(eq(leads.id, call.leadId));

    await logActivity(tx, {
      leadId: call.leadId, eventType: 'SETTER_CALL_NO_ANSWER',
      title: `${label(CALL_TYPE, call.callType)} · intento ${call.attemptNumber} · no contesta`,
      actorType: 'user', actorUserId: input.userId,
    });

    // 2. Se cierra la tarea del intento actual.
    const openTasks = await tx.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.relatedSetterCallId, call.id), eq(tasks.status, 'pending')));
    for (const t of openTasks) await completeTask(tx, t.id, input.userId, 'no_answer');

    await emit(tx, {
      eventType: 'setter_call.no_answer', entityType: 'setter_call',
      entityId: call.id, leadId: call.leadId,
      actorType: 'user', actorUserId: input.userId,
      payload: { attempt: call.attemptNumber },
    });

    // 3. ¿Toca reintento? Nunca llamadas infinitas.
    const nextAttempt = call.attemptNumber + 1;
    if (nextAttempt > policy.max_attempts) {
      await tx.update(leads).set({
        contactStatus: 'unreachable',
        // qualification_status se queda en `not_assessed`: no hemos hablado
        // con él, así que no sabemos si encaja. Marcarlo "no cualificado"
        // aquí contaminaría el análisis de calidad de tráfico.
        updatedAt: new Date(),
      }).where(eq(leads.id, call.leadId));

      await logActivity(tx, {
        leadId: call.leadId, eventType: 'LEAD_UNREACHABLE',
        title: `Sin contacto tras ${policy.max_attempts} intentos`,
        description: 'No se generan más llamadas. Sigue sin evaluar, no descalificado.',
      });

      return { retryScheduled: false, nextAt: null, attempt: call.attemptNumber };
    }

    const nextAt = computeRetryAt(nextAttempt, policy);

    const retry = await tx.insert(setterCalls).values({
      leadId: call.leadId, setterId: call.setterId, launchId: call.launchId,
      callType: call.callType,
      callGroupId: call.callGroupId,          // mismo grupo: es la misma llamada lógica
      attemptNumber: nextAttempt,
      parentCallId: call.id,
      meetingId: call.meetingId,
      scheduledAt: nextAt,
      status: 'scheduled',
    }).returning({ id: setterCalls.id });

    await upsertSmartTask(tx, {
      dedupeKey: `retry:${call.callGroupId}:${nextAttempt}`,
      title: `Reintentar llamada · ${lead[0]?.fullName ?? ''}`,
      reason: `Intento ${call.attemptNumber} sin respuesta. Reintento programado.`,
      taskType: 'call_1_retry',
      assigneeId: call.setterId,
      dueAt: nextAt,
      priority: 'high',
      launchId: call.launchId,
      relatedLeadId: call.leadId,
      relatedMeetingId: call.meetingId,
      relatedSetterCallId: retry[0].id,
      ruleCode: 'RETRY_SETTER_CALL',
    });

    return { retryScheduled: true, nextAt, attempt: nextAttempt };
  });
}

function computeRetryAt(attempt: number, policy: RetryPolicy): Date {
  const d = new Date();
  if (attempt === 2) {
    d.setMinutes(d.getMinutes() + policy.first_retry_minutes);
    return d;
  }
  // A partir del tercero, al día siguiente por la mañana.
  d.setDate(d.getDate() + 1);
  d.setHours(policy.second_retry_hour, 0, 0, 0);
  return d;
}

/* ── Contesta ────────────────────────────────────────────────────────── */

export type CompleteCallInput = {
  callId: string;
  userId: string;
  answers: Record<string, string>;
  notes?: string | null;
  // Call #1
  interestLevel?: 'low' | 'medium' | 'high' | 'very_high';
  qualification?: 'qualified' | 'disqualified';
  disqualificationReason?: string | null;
  nextAction?: string | null;
  // Call #2
  attendanceIntent?: 'confirmed' | 'likely' | 'unsure' | 'cannot_attend';
  // Call #3
  meetingConfirmation?: 'confirmed' | 'reschedule_requested' | 'cancelled' | 'uncertain';
};

export async function completeCall(input: CompleteCallInput) {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(setterCalls)
      .where(eq(setterCalls.id, input.callId)).limit(1);
    if (!rows.length) throw new Error('CALL_NOT_FOUND');
    const call = rows[0];

    validateCall(call.callType as CallType, input);

    await tx.update(setterCalls).set({
      status: 'completed', answered: true, resultCode: 'answered',
      completedAt: new Date(), updatedAt: new Date(),
      interestLevel: input.interestLevel ?? null,
      qualification: input.qualification ?? null,
      disqualificationReason: input.disqualificationReason ?? null,
      attendanceIntent: input.attendanceIntent ?? null,
      meetingConfirmation: input.meetingConfirmation ?? null,
      notes: input.notes ?? null,
    }).where(eq(setterCalls.id, call.id));

    // Respuestas estructuradas, no solo una nota libre: sin esto no se puede
    // agregar nada después ni dar contexto al closer.
    const questions = await tx.select().from(setterCallQuestions)
      .where(and(eq(setterCallQuestions.callType, call.callType), eq(setterCallQuestions.active, true)));

    for (const q of questions) {
      const a = input.answers[q.code];
      if (!a) continue;
      await tx.insert(setterCallAnswers).values({
        setterCallId: call.id, questionId: q.id,
        questionTextSnapshot: q.questionText, answerText: a,
      });
    }

    const leadRow = await tx.select().from(leads).where(eq(leads.id, call.leadId)).limit(1);
    const lead = leadRow[0];
    const patch: Record<string, unknown> = { contactStatus: 'contacted', updatedAt: new Date() };

    if (call.callType === 'post_class_1' && input.qualification) {
      patch.qualificationStatus = input.qualification;
      patch.interestLevel = input.interestLevel ?? null;
      if (input.qualification === 'qualified') {
        patch.status = applyAutomaticStatus(lead.status as LeadStatus, 'qualified');
        patch.qualifiedAt = new Date();
        patch.nextActionType = input.nextAction ?? 'confirm_live';
      } else {
        patch.status = applyAutomaticStatus(lead.status as LeadStatus, 'disqualified');
      }
    }

    if (call.callType === 'webinar_confirmation' && input.attendanceIntent) {
      patch.liveConfirmation = input.attendanceIntent;
      // OJO: esto es una DECLARACIÓN del lead, no asistencia real.
      // webinar_attended sigue NULL hasta que haya una fuente fiable.
    }

    await tx.update(leads).set(patch).where(eq(leads.id, call.leadId));

    if (call.callType === 'meeting_24h' && call.meetingId && input.meetingConfirmation) {
      const { applyConfirmation24h } = await import('./meetings');
      await applyConfirmation24h(tx, call.meetingId, input.meetingConfirmation, input.userId);
    }

    const openTasks = await tx.select({ id: tasks.id }).from(tasks)
      .where(and(eq(tasks.relatedSetterCallId, call.id), eq(tasks.status, 'pending')));
    for (const t of openTasks) await completeTask(tx, t.id, input.userId, 'answered');

    await logActivity(tx, {
      leadId: call.leadId, eventType: 'SETTER_CALL_COMPLETED',
      title: `${label(CALL_TYPE, call.callType)} completada`,
      description: summarize(call.callType as CallType, input),
      actorType: 'user', actorUserId: input.userId,
    });

    await emit(tx, {
      eventType: 'setter_call.completed', entityType: 'setter_call',
      entityId: call.id, leadId: call.leadId,
      actorType: 'user', actorUserId: input.userId,
      payload: { qualification: input.qualification ?? null },
    });

    if (input.qualification === 'qualified') {
      await emit(tx, {
        eventType: 'lead.qualified', entityType: 'lead', entityId: call.leadId,
        leadId: call.leadId, actorType: 'user', actorUserId: input.userId,
      });
    }

    return { ok: true };
  });
}

/** Validación en servidor. El `required` del navegador no es una validación. */
function validateCall(type: CallType, i: CompleteCallInput) {
  if (type === 'post_class_1') {
    if (!i.interestLevel) throw new Error('FALTA_INTERES: indica el nivel de interés.');
    if (!i.qualification) throw new Error('FALTA_CUALIFICACION: indica si el lead está cualificado.');
    if (i.qualification === 'disqualified' && !i.disqualificationReason) {
      throw new Error('FALTA_MOTIVO: descalificar exige indicar el motivo.');
    }
  }
  if (type === 'webinar_confirmation' && !i.attendanceIntent) {
    throw new Error('FALTA_CONFIRMACION: indica si podrá conectarse al directo.');
  }
  if (type === 'meeting_24h' && !i.meetingConfirmation) {
    throw new Error('FALTA_CONFIRMACION: indica si confirma la reunión.');
  }
}

function summarize(type: CallType, i: CompleteCallInput): string {
  if (type === 'post_class_1') {
    return i.qualification === 'qualified'
      ? `Cualificado · interés ${i.interestLevel}`
      : `No cualificado · ${i.disqualificationReason ?? ''}`;
  }
  if (type === 'webinar_confirmation') return `Directo: ${i.attendanceIntent}`;
  return `Reunión: ${i.meetingConfirmation}`;
}

/** Última llamada de un lead, para la cabecera de la ficha. */
export async function lastCallFor(leadId: string) {
  const rows = await db.select().from(setterCalls)
    .where(eq(setterCalls.leadId, leadId))
    .orderBy(desc(setterCalls.createdAt)).limit(1);
  return rows[0] ?? null;
}
