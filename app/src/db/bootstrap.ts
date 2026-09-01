import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db, execRaw, usingEmbeddedDb } from './index';
import { seed } from './seed';

/**
 * Arranque automático del Postgres embebido.
 *
 * Solo actúa cuando NO hay DATABASE_URL. Si la base está vacía, aplica la
 * migración y siembra los datos de ejemplo. Contra un Postgres real no toca
 * nada: ahí las migraciones se aplican a mano y a conciencia, que es como
 * debe ser en producción.
 *
 * La promesa se memoiza en globalThis: en desarrollo Next recarga los módulos
 * a cada cambio y sin esto se intentaría sembrar en cada recarga.
 */
const g = globalThis as unknown as { __crmBootstrap?: Promise<void> };

async function run(): Promise<void> {
  if (!usingEmbeddedDb()) return;

  const already = await db.execute(sql`
    select to_regclass('public.users') is not null as ready
  `) as unknown as Array<{ ready: boolean }>;

  const rows = Array.isArray(already) ? already : (already as { rows?: unknown[] }).rows ?? [];
  const ready = (rows[0] as { ready?: boolean } | undefined)?.ready;

  if (ready) {
    const count = await db.execute(sql`select count(*)::int as n from users`) as unknown as Array<{ n: number }>;
    const cr = Array.isArray(count) ? count : (count as { rows?: unknown[] }).rows ?? [];
    if (((cr[0] as { n?: number } | undefined)?.n ?? 0) > 0) return;
  } else {
    console.log('[db] Base vacía: creando el schema…');
    const dir = join(process.cwd(), 'drizzle');
    if (!existsSync(dir)) {
      throw new Error('Falta la carpeta drizzle/. Ejecuta: npm run db:generate');
    }
    // TODAS las migraciones, en orden. Aplicar solo la primera deja la base
    // a medias en cuanto exista una segunda.
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await execRaw(readFileSync(join(dir, file), 'utf8').replace(/--> statement-breakpoint/g, ''));
    }
    await execRaw(readFileSync(join(process.cwd(), 'src/db/init.sql'), 'utf8'));
  }

  console.log('[db] Sembrando datos de ejemplo…');
  await seed(db);
  console.log('[db] Listo. Entra en /login.');
}

export function ensureDbReady(): Promise<void> {
  if (!g.__crmBootstrap) {
    g.__crmBootstrap = run().catch((err) => {
      // Si falla, se limpia la promesa para poder reintentar en la siguiente
      // petición en vez de dejar la aplicación rota hasta reiniciar.
      g.__crmBootstrap = undefined;
      throw err;
    });
  }
  return g.__crmBootstrap;
}
