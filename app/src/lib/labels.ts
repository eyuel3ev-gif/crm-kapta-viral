/**
 * La interfaz va en español; la base de datos en inglés snake_case.
 * Este fichero es la única frontera entre ambos.
 *
 * Motivo: cambiar un label en pantalla no puede romper datos históricos
 * ni consultas. "Reunión agendada" puede pasar a llamarse otra cosa
 * mañana; `meeting_scheduled` no cambia nunca.
 */

export type Tone = 'neutral' | 'positive' | 'negative' | 'warning' | 'info' | 'ai';

type Entry = { label: string; tone: Tone };

const def = (label: string, tone: Tone = 'neutral'): Entry => ({ label, tone });

export const LEAD_STATUS: Record<string, Entry> = {
  new: def('Nuevo', 'info'),
  contacted: def('Contactado', 'info'),
  qualified: def('Cualificado', 'positive'),
  disqualified: def('No cualificado', 'neutral'),
  meeting_scheduled: def('Reunión agendada', 'info'),
  meeting_held: def('Reunión realizada', 'info'),
  follow_up: def('Seguimiento', 'warning'),
  won: def('Ganado', 'positive'),
  lost: def('Perdido', 'negative'),
};

export const CONTACT_STATUS: Record<string, Entry> = {
  not_attempted: def('Sin contactar'),
  attempted: def('Intento realizado', 'warning'),
  contacted: def('Contactado', 'positive'),
  // "No contactable" NO significa "no cualificado". Son preguntas distintas.
  unreachable: def('No contactable', 'negative'),
};

export const QUALIFICATION_STATUS: Record<string, Entry> = {
  not_assessed: def('Sin evaluar'),
  qualified: def('Cualificado', 'positive'),
  disqualified: def('No cualificado', 'negative'),
};

export const INTEREST_LEVEL: Record<string, Entry> = {
  low: def('Bajo', 'neutral'),
  medium: def('Medio', 'info'),
  high: def('Alto', 'positive'),
  very_high: def('Muy alto', 'positive'),
};

export const MEETING_STATUS: Record<string, Entry> = {
  scheduled: def('Programada', 'info'),
  completed: def('Realizada', 'positive'),
  no_show: def('No-show', 'negative'),
  cancelled: def('Cancelada', 'neutral'),
};

export const COMMERCIAL_RESULT: Record<string, Entry> = {
  pending: def('Pendiente', 'warning'),
  won: def('Ganado', 'positive'),
  lost: def('Perdido', 'negative'),
  follow_up: def('Seguimiento', 'warning'),
};

export const CONFIRMATION_24H: Record<string, Entry> = {
  pending: def('Pendiente', 'warning'),
  confirmed: def('Confirmada', 'positive'),
  reschedule_requested: def('Pide reagendar', 'warning'),
  cancelled: def('Cancela', 'negative'),
  uncertain: def('Dudoso', 'warning'),
  no_answer: def('No contesta', 'neutral'),
};

export const ATTENDANCE_INTENT: Record<string, Entry> = {
  confirmed: def('Confirmado', 'positive'),
  likely: def('Probablemente sí', 'info'),
  unsure: def('Dudoso', 'warning'),
  cannot_attend: def('No puede', 'negative'),
  no_answer: def('No contesta', 'neutral'),
};

export const CALL_TYPE: Record<string, Entry> = {
  post_class_1: def('Llamada #1 · Cualificación'),
  webinar_confirmation: def('Llamada #2 · Confirmar directo'),
  meeting_24h: def('Llamada #3 · Confirmación 24 h'),
};

export const TASK_TYPE: Record<string, Entry> = {
  call_1: def('Llamada de cualificación'),
  call_1_retry: def('Reintento de llamada', 'warning'),
  confirm_live: def('Confirmar directo'),
  confirm_meeting_24h: def('Confirmar reunión 24 h', 'negative'),
  meeting_result: def('Registrar resultado', 'warning'),
  follow_up: def('Seguimiento', 'warning'),
  manual: def('Tarea manual'),
};

export const TASK_PRIORITY: Record<string, Entry> = {
  low: def('Baja'),
  medium: def('Media', 'info'),
  high: def('Alta', 'warning'),
  critical: def('Crítica', 'negative'),
};

export const TASK_STATUS: Record<string, Entry> = {
  pending: def('Pendiente', 'info'),
  in_progress: def('En proceso', 'warning'),
  completed: def('Completada', 'positive'),
  cancelled: def('Cancelada', 'neutral'),
};

export const FINANCING_STATUS: Record<string, Entry> = {
  not_applicable: def('No aplica'),
  not_requested: def('No solicitada'),
  requested: def('Solicitada', 'warning'),
  approved: def('Aprobada', 'positive'),
  rejected: def('Rechazada', 'negative'),
  pending: def('Pendiente', 'warning'),
};

export const PAYMENT_METHOD: Record<string, Entry> = {
  card: def('Tarjeta'),
  transfer: def('Transferencia'),
  financing: def('Financiación'),
  other: def('Otro'),
};

export const SOURCE: Record<string, Entry> = {
  meta: def('Meta Ads', 'info'),
  organic: def('Orgánico', 'positive'),
  referral: def('Referido', 'positive'),
  direct: def('Directo'),
  unknown: def('Desconocido'),
};

export const ROLE: Record<string, Entry> = {
  owner: def('Propietario'),
  setter: def('Setter'),
  closer: def('Closer'),
};

/** Traduce un código. Si no lo conoce devuelve el propio código: preferimos
 *  ver `weird_status` en pantalla a esconder un dato que no esperábamos. */
export function label(dict: Record<string, Entry>, code: string | null | undefined): string {
  if (!code) return '—';
  return dict[code]?.label ?? code;
}

export function tone(dict: Record<string, Entry>, code: string | null | undefined): Tone {
  if (!code) return 'neutral';
  return dict[code]?.tone ?? 'neutral';
}
