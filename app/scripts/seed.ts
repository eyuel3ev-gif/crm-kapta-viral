/**
 * Siembra la base de datos desde la línea de comandos.
 *
 *   npm run db:seed
 *
 * Con DATABASE_URL usa ese Postgres; sin ella, el embebido de ./.pglite.
 */
import 'dotenv/config';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db, execRaw, usingEmbeddedDb } from '../src/db';
import { seed } from '../src/db/seed';

async function main() {
  console.log(usingEmbeddedDb()
    ? '→ Postgres embebido (./.pglite)'
    : '→ Postgres remoto (DATABASE_URL)');

  // Contra el embebido, el schema puede no existir todavía.
  if (usingEmbeddedDb()) {
    const dir = join(process.cwd(), 'drizzle');
    if (!existsSync(dir)) throw new Error('Falta drizzle/. Ejecuta: npm run db:generate');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const ddl = readFileSync(join(dir, file), 'utf8').replace(/--> statement-breakpoint/g, '');
      try { await execRaw(ddl); } catch { /* ya existía */ }
    }
  }

  // init.sql es idempotente: secuencia IF NOT EXISTS y CHECKs condicionales.
  await execRaw(readFileSync(join(process.cwd(), 'src/db/init.sql'), 'utf8'));

  console.log('→ Sembrando…');
  await seed(db);
  console.log('\n✓ Listo. Usuarios: Álvar · Eyuel · Ryan (propietarios) · Darío (closer) · Ángel (setter)\n');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
