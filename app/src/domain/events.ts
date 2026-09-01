import { db } from '@/db';
import { domainEvents, leadActivity, auditLog } from '@/db/schema';

/**
 * Los tres registros del sistema. Se parecen y NO son lo mismo:
 *
 *   domain_events  → outbox. Se escribe dentro de la misma transacción que la
 *                    mutación; un worker lo despacha después. De aquí salen
 *                    las Smart Tasks, las notificaciones y (en V1) el CAPI.
 *   lead_activity  → la historia comercial legible del lead. La lee una persona.
 *   audit_log      → quién cambió qué y desde qué valor. La lee una auditoría.
 *
 * Fusionarlos parece un ahorro y luego impide responder "¿qué le pasó a este
 * lead?" sin leer 300 filas de cambios de campo.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

export type DomainEventType =
  | 'lead.created' | 'lead.updated' | 'lead.qualified' | 'lead.disqualified'
  | 'lead.possible_duplicate_detected'
  | 'form.submitted'
  | 'setter_call.scheduled' | 'setter_call.answered' | 'setter_call.no_answer'
  | 'setter_call.completed'
  | 'live.confirmation_updated'
  | 'meeting.booked' | 'meeting.rescheduled' | 'meeting.cancelled'
  | 'meeting.confirmation_updated' | 'meeting.completed' | 'meeting.no_show'
  | 'meeting.follow_up_created'
  | 'sale.won' | 'sale.corrected'
  | 'task.created' | 'task.completed' | 'task.cancelled';

export async function emit(
  tx: Tx,
  e: {
    eventType: DomainEventType;
    entityType: string;
    entityId: string;
    leadId?: string | null;
    actorType?: 'user' | 'system' | 'integration' | 'ai';
    actorUserId?: string | null;
    payload?: Record<string, unknown>;
    correlationId?: string | null;
  },
) {
  await tx.insert(domainEvents).values({
    eventType: e.eventType,
    entityType: e.entityType,
    entityId: e.entityId,
    leadId: e.leadId ?? null,
    actorType: e.actorType ?? 'system',
    actorUserId: e.actorUserId ?? null,
    payload: e.payload ?? {},
    correlationId: e.correlationId ?? null,
  });
}

export async function logActivity(
  tx: Tx,
  a: {
    leadId: string;
    eventType: string;
    title: string;
    description?: string | null;
    actorType?: 'user' | 'system' | 'integration' | 'ai';
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
    occurredAt?: Date;
  },
) {
  await tx.insert(leadActivity).values({
    leadId: a.leadId,
    eventType: a.eventType,
    title: a.title,
    description: a.description ?? null,
    actorType: a.actorType ?? 'system',
    actorUserId: a.actorUserId ?? null,
    metadata: a.metadata ?? {},
    ...(a.occurredAt ? { occurredAt: a.occurredAt } : {}),
  });
}

export async function logAudit(
  tx: Tx,
  a: {
    actorUserId?: string | null;
    actorType?: string;
    action: string;
    entityType: string;
    entityId: string;
    oldValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
    reason?: string | null;
  },
) {
  await tx.insert(auditLog).values({
    actorUserId: a.actorUserId ?? null,
    actorType: a.actorType ?? 'user',
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    oldValues: a.oldValues ?? null,
    newValues: a.newValues ?? null,
    reason: a.reason ?? null,
  });
}
