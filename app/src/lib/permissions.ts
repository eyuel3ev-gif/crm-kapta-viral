import type { Session, RoleCode } from './auth';

/**
 * Permisos.
 *
 * Regla del proyecto: esconder un botón NO es un permiso. Todo lo que se
 * comprueba aquí se comprueba en el servidor, dentro de la server action o
 * del route handler, antes de tocar la base de datos. Si esta capa solo se
 * usara para pintar la interfaz, cualquiera con la URL entraría igual.
 */

export type Permission =
  | 'lead.read_all' | 'lead.read_assigned' | 'lead.create' | 'lead.update'
  | 'lead.update_attribution' | 'lead.assign' | 'lead.merge'
  | 'setter_call.read_all' | 'setter_call.manage_assigned'
  | 'meeting.read_all' | 'meeting.manage_assigned' | 'meeting.result'
  | 'sale.create' | 'sale.correct'
  | 'task.read_all' | 'task.manage_all' | 'task.manage_assigned'
  | 'analytics.read_global' | 'team.read'
  | 'settings.manage' | 'user.manage'
  | 'ai_diagnostic.run' | 'audit.read';

const OWNER: Permission[] = [
  'lead.read_all', 'lead.read_assigned', 'lead.create', 'lead.update',
  'lead.update_attribution', 'lead.assign', 'lead.merge',
  'setter_call.read_all', 'setter_call.manage_assigned',
  'meeting.read_all', 'meeting.manage_assigned', 'meeting.result',
  'sale.create', 'sale.correct',
  'task.read_all', 'task.manage_all', 'task.manage_assigned',
  'analytics.read_global', 'team.read',
  'settings.manage', 'user.manage',
  'ai_diagnostic.run', 'audit.read',
];

const SETTER: Permission[] = [
  // Solo sus leads. Nada de revenue, spend, CAC ni ROAS.
  'lead.read_assigned', 'lead.update',
  'setter_call.manage_assigned',
  'task.manage_assigned',
];

const CLOSER: Permission[] = [
  // Los leads de sus reuniones, y el resultado comercial de esas reuniones.
  // No toca atribución ni campañas.
  'lead.read_assigned',
  'meeting.manage_assigned', 'meeting.result',
  'sale.create',
  'task.manage_assigned',
  'ai_diagnostic.run',
];

const BY_ROLE: Record<RoleCode, Permission[]> = {
  owner: OWNER,
  setter: SETTER,
  closer: CLOSER,
};

export function can(session: Session, permission: Permission): boolean {
  return session.roles.some((r) => BY_ROLE[r]?.includes(permission));
}

/** Lanza si no puede. Usar SIEMPRE al principio de cada server action. */
export function assertCan(session: Session, permission: Permission): void {
  if (!can(session, permission)) {
    throw new Error(`FORBIDDEN: falta el permiso ${permission}`);
  }
}

/**
 * Alcance de lectura de leads.
 *   · owner  → todos
 *   · setter → los que tiene asignados
 *   · closer → los que tienen una reunión suya
 * Se traduce a un WHERE en la consulta, no a un filtro en memoria: filtrar
 * después de traer las filas significa que ya viajaron fuera de la base.
 */
export type LeadScope =
  | { kind: 'all' }
  | { kind: 'setter'; userId: string }
  | { kind: 'closer'; userId: string };

export function leadScopeFor(session: Session): LeadScope {
  if (can(session, 'lead.read_all')) return { kind: 'all' };
  if (session.roles.includes('closer')) return { kind: 'closer', userId: session.userId };
  return { kind: 'setter', userId: session.userId };
}
