import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { tasks } from '@/db/schema';
import { emit } from './events';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export type TaskType =
  | 'call_1' | 'call_1_retry' | 'confirm_live' | 'confirm_meeting_24h'
  | 'meeting_result' | 'follow_up' | 'manual';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Smart Task: la crea una regla, no una persona.
 *
 * `dedupeKey` es lo que impide que un cron cada 5 minutos genere 12 tareas
 * idénticas para la misma reunión. Con ON CONFLICT DO NOTHING, ejecutar la
 * regla 300 veces produce exactamente una tarea.
 *
 * `reason` es obligatorio a propósito: una tarea automática que no explica
 * por qué existe es ruido, y el equipo aprende a ignorarla.
 */
export async function upsertSmartTask(
  tx: Tx,
  t: {
    dedupeKey: string;
    title: string;
    reason: string;
    taskType: TaskType;
    assigneeId?: string | null;
    dueAt?: Date | null;
    priority?: Priority;
    launchId?: string | null;
    relatedLeadId?: string | null;
    relatedMeetingId?: string | null;
    relatedSetterCallId?: string | null;
    ruleCode?: string;
  },
): Promise<string | null> {
  const rows = await tx.insert(tasks).values({
    dedupeKey: t.dedupeKey,
    title: t.title,
    reason: t.reason,
    taskType: t.taskType,
    source: 'automation',
    automationRuleCode: t.ruleCode ?? null,
    assigneeId: t.assigneeId ?? null,
    dueAt: t.dueAt ?? null,
    priority: t.priority ?? 'medium',
    launchId: t.launchId ?? null,
    relatedLeadId: t.relatedLeadId ?? null,
    relatedMeetingId: t.relatedMeetingId ?? null,
    relatedSetterCallId: t.relatedSetterCallId ?? null,
  }).onConflictDoNothing({ target: tasks.dedupeKey }).returning({ id: tasks.id });

  if (!rows.length) return null;      // ya existía: no es un error

  await emit(tx, {
    eventType: 'task.created', entityType: 'task', entityId: rows[0].id,
    leadId: t.relatedLeadId ?? null, payload: { taskType: t.taskType, rule: t.ruleCode },
  });
  return rows[0].id;
}

export async function createManualTask(
  tx: Tx,
  t: {
    title: string;
    description?: string | null;
    taskType?: TaskType;
    category?: string;
    priority?: Priority;
    impact?: string | null;
    assigneeId?: string | null;
    createdById: string;
    dueAt?: Date | null;
    relatedLeadId?: string | null;
    launchId?: string | null;
  },
): Promise<string> {
  const rows = await tx.insert(tasks).values({
    title: t.title,
    description: t.description ?? null,
    taskType: t.taskType ?? 'manual',
    category: t.category ?? 'commercial',
    priority: t.priority ?? 'medium',
    impact: t.impact ?? null,
    source: 'manual',
    assigneeId: t.assigneeId ?? null,
    createdById: t.createdById,
    dueAt: t.dueAt ?? null,
    relatedLeadId: t.relatedLeadId ?? null,
    launchId: t.launchId ?? null,
  }).returning({ id: tasks.id });

  await emit(tx, {
    eventType: 'task.created', entityType: 'task', entityId: rows[0].id,
    leadId: t.relatedLeadId ?? null, actorType: 'user', actorUserId: t.createdById,
  });
  return rows[0].id;
}

/**
 * Completar no borra: la tarea desaparece de "Pendientes" pero sigue en el
 * histórico y en las métricas. Borrarla haría imposible medir puntualidad.
 */
export async function completeTask(
  tx: Tx, taskId: string, userId: string, outcome?: string,
) {
  await tx.update(tasks).set({
    status: 'completed',
    completedAt: new Date(),
    completedBy: userId,
    completionOutcome: outcome ?? null,
    updatedAt: new Date(),
  }).where(eq(tasks.id, taskId));

  await emit(tx, {
    eventType: 'task.completed', entityType: 'task', entityId: taskId,
    actorType: 'user', actorUserId: userId,
  });
}

/**
 * Cancela tareas que han dejado de tener sentido.
 * Caso típico: se reagenda una reunión y la confirmación de 24 h antigua
 * apunta a una hora que ya no existe. Dejarla viva hace que el setter llame
 * para confirmar una cita equivocada.
 */
export async function supersedeTasks(
  tx: Tx,
  filter: { meetingId?: string; leadId?: string; taskTypes: TaskType[] },
  reason: string,
) {
  const conds = [
    inArray(tasks.taskType, filter.taskTypes),
    inArray(tasks.status, ['pending', 'in_progress']),
  ];
  if (filter.meetingId) conds.push(eq(tasks.relatedMeetingId, filter.meetingId));
  if (filter.leadId) conds.push(eq(tasks.relatedLeadId, filter.leadId));

  await tx.update(tasks).set({
    status: 'cancelled',
    cancelledReason: reason,
    updatedAt: new Date(),
    // Se libera la dedupe_key para que la regla pueda crear la tarea nueva.
    dedupeKey: sql`${tasks.dedupeKey} || ':cancelled:' || ${tasks.id}`,
  }).where(and(...conds));
}
