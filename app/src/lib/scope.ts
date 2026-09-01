import { cookies } from 'next/headers';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { launches } from '@/db/schema';

/**
 * Evergreen y Lanzamiento conviven en el mismo CRM, y casi siempre hay que
 * mirarlos por separado.
 *
 * Mezclarlos miente en las dos direcciones: un evergreen que vende de forma
 * constante todo el mes hunde el close rate de un lanzamiento de tres días, y
 * un lanzamiento con un pico de 20 ventas hace parecer que el evergreen
 * despegó. Son dos negocios con ritmos distintos.
 *
 * La selección vive en una cookie, así que se mantiene al navegar y cada
 * persona puede tener la suya.
 */

export type ScopeMode = 'all' | 'evergreen' | 'launch';

export type LaunchScope = {
  mode: ScopeMode;
  /** null = sin filtrar. Si no, los launch_id que entran. */
  launchIds: string[] | null;
  label: string;
};

const COOKIE = 'crm_scope';

export const SCOPE_LABEL: Record<ScopeMode, string> = {
  all: 'Todo',
  evergreen: 'Evergreen',
  launch: 'Lanzamiento',
};

export async function getScopeMode(): Promise<ScopeMode> {
  const jar = await cookies();
  const v = jar.get(COOKIE)?.value;
  return v === 'evergreen' || v === 'launch' ? v : 'all';
}

export async function setScopeMode(mode: ScopeMode) {
  const jar = await cookies();
  jar.set(COOKIE, mode, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
}

/**
 * Resuelve el modo a la lista concreta de lanzamientos.
 *
 * Devuelve `launchIds: null` para "Todo" — así la consulta no añade ningún
 * WHERE en lugar de meter un IN con todos los ids, que sería más lento y
 * fallaría en cuanto se cree un lanzamiento nuevo.
 */
export async function resolveScope(mode?: ScopeMode): Promise<LaunchScope> {
  const m = mode ?? await getScopeMode();
  if (m === 'all') return { mode: 'all', launchIds: null, label: SCOPE_LABEL.all };

  const rows = await db.select({ id: launches.id }).from(launches).where(eq(launches.type, m));
  return { mode: m, launchIds: rows.map((r) => r.id), label: SCOPE_LABEL[m] };
}

/** Condición reutilizable para cualquier tabla que tenga `launch_id`. */
export function scopeFilter(
  column: Parameters<typeof inArray>[0],
  scope: LaunchScope,
) {
  if (!scope.launchIds) return undefined;
  // Lista vacía: no existe ningún lanzamiento de ese tipo todavía. Se fuerza
  // un resultado vacío en lugar de devolverlo todo sin filtrar.
  if (scope.launchIds.length === 0) return inArray(column, ['00000000-0000-0000-0000-000000000000']);
  return inArray(column, scope.launchIds);
}

/** Todos los lanzamientos, para el selector y la pantalla de configuración. */
export async function listLaunches() {
  return db.select().from(launches).orderBy(launches.type, launches.createdAt);
}
