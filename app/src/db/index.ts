import { drizzle as drizzlePg, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import postgres from 'postgres';
import { PGlite } from '@electric-sql/pglite';
import * as schema from './schema';

/**
 * Conexión perezosa con dos motores.
 *
 *   CON DATABASE_URL  → Postgres real (Supabase, Neon, local…). Producción.
 *   SIN DATABASE_URL  → PGlite: Postgres compilado a WebAssembly, guardado en
 *                       `.pglite/`. Arranca solo, crea el schema y siembra
 *                       datos de ejemplo en el primer acceso.
 *
 * El segundo modo existe para que `npm run dev` funcione sin instalar nada ni
 * abrir cuenta en ningún sitio. Es Postgres de verdad —mismos tipos, mismas
 * restricciones— así que lo que funciona aquí funciona en Supabase.
 *
 * Importar estos módulos no abre ninguna conexión; la conexión se crea en la
 * primera consulta. Importa porque `next build` carga todas las rutas para
 * analizarlas, y compilar no debería exigir una base de datos viva.
 */

type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __crmDb?: Db;
  __crmExecRaw?: (text: string) => Promise<void>;
};

function createDb(): Db {
  const url = process.env.DATABASE_URL;

  if (url) {
    const client = postgres(url, { max: 10, prepare: false });
    globalForDb.__crmExecRaw = async (text) => { await client.unsafe(text); };
    return drizzlePg(client, { schema });
  }

  const client = new PGlite('./.pglite');
  globalForDb.__crmExecRaw = async (text) => { await client.exec(text); };
  console.log('[db] Sin DATABASE_URL: usando Postgres embebido en ./.pglite');
  return drizzlePglite(client, { schema }) as unknown as Db;
}

function getDb(): Db {
  if (!globalForDb.__crmDb) globalForDb.__crmDb = createDb();
  return globalForDb.__crmDb;
}

/** Se comporta como el cliente de Drizzle, pero conecta al primer uso. */
export const db = new Proxy({} as Db, {
  get(_t, prop, receiver) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(real, prop, receiver);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

/**
 * Ejecuta SQL en bruto: varias sentencias seguidas, bloques `DO $$ … $$`,
 * migraciones completas.
 *
 * Hace falta porque `db.execute()` usa el protocolo extendido de Postgres,
 * que solo admite UNA sentencia y no digiere los bloques anónimos. Es lo que
 * necesitan `init.sql` y las migraciones.
 */
export async function execRaw(text: string): Promise<void> {
  getDb();                                   // fuerza la creación del cliente
  if (!globalForDb.__crmExecRaw) throw new Error('Cliente no inicializado');
  await globalForDb.__crmExecRaw(text);
}

/**
 * Primera fila de un `db.execute()`.
 *
 * Hace falta porque los dos drivers devuelven formas distintas: postgres-js
 * devuelve un array de filas y PGlite un objeto `{ rows }`. Leer `[0]` a pelo
 * funciona en uno y revienta en el otro.
 */
export function firstRow<T>(result: unknown): T | undefined {
  if (Array.isArray(result)) return result[0] as T | undefined;
  const rows = (result as { rows?: unknown[] })?.rows;
  return Array.isArray(rows) ? (rows[0] as T | undefined) : undefined;
}

export const usingEmbeddedDb = () => !process.env.DATABASE_URL;

export { schema };
