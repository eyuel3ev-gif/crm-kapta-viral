/**
 * Máquina de estados del lead.
 *
 * Dos cosas que evita:
 *
 * 1. Estados imposibles. `won` no puede volver a `new` porque llegue tarde
 *    un webhook antiguo.
 * 2. Degradación por eventos atrasados. Calendly puede reenviar un
 *    `invitee.created` de hace tres días cuando el lead ya está cerrado.
 *    Ese evento entra al historial, pero NO toca el estado actual.
 *
 * El rango numérico es lo que implementa la regla 2: una automatización
 * nunca baja de rango. Una persona sí, con permiso y dejando motivo.
 */

export type LeadStatus =
  | 'new' | 'contacted' | 'qualified' | 'disqualified'
  | 'meeting_scheduled' | 'meeting_held' | 'follow_up'
  | 'won' | 'lost';

/** A mayor rango, más avanzado en el embudo. */
export const STATUS_RANK: Record<LeadStatus, number> = {
  new: 0,
  contacted: 10,
  disqualified: 15,
  qualified: 20,
  meeting_scheduled: 30,
  meeting_held: 40,
  follow_up: 45,
  lost: 90,
  won: 100,
};

const ALLOWED: Record<LeadStatus, LeadStatus[]> = {
  new: ['contacted', 'qualified', 'disqualified', 'meeting_scheduled'],
  contacted: ['qualified', 'disqualified', 'meeting_scheduled'],
  qualified: ['meeting_scheduled', 'lost', 'disqualified'],
  disqualified: ['qualified', 'contacted'],
  meeting_scheduled: ['meeting_held', 'follow_up', 'won', 'lost', 'meeting_scheduled'],
  meeting_held: ['won', 'lost', 'follow_up', 'meeting_scheduled'],
  follow_up: ['meeting_scheduled', 'meeting_held', 'won', 'lost'],
  won: [],
  lost: ['follow_up', 'meeting_scheduled'],
};

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from]?.includes(to) ?? false;
}

/**
 * Decide si una automatización debe aplicar un cambio de estado.
 * Devuelve el estado resultante, que puede ser el mismo que había.
 *
 * Ejemplo real: llega `meeting.booked` retrasado sobre un lead ya en `won`.
 * rank(meeting_scheduled)=30 < rank(won)=100 → se queda en `won`.
 */
export function applyAutomaticStatus(current: LeadStatus, proposed: LeadStatus): LeadStatus {
  if (current === proposed) return current;
  if (STATUS_RANK[proposed] <= STATUS_RANK[current]) return current;
  if (!canTransition(current, proposed)) return current;
  return proposed;
}

/** Un cambio manual del Owner sí puede degradar, pero exige motivo y audita. */
export function assertManualTransition(from: LeadStatus, to: LeadStatus, reason?: string) {
  if (from === to) return;
  if (!reason || reason.trim().length < 3) {
    throw new Error('MOTIVO_REQUERIDO: corregir un estado a mano exige indicar por qué.');
  }
}
