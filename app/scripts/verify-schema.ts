/**
 * Verificación del schema contra Postgres embebido (PGlite).
 *
 * Aplica la migración generada por drizzle-kit + init.sql y comprueba que las
 * reglas de integridad del proyecto se cumplen de verdad, no solo en el papel.
 *
 *   npx tsx scripts/verify-schema.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const pass: string[] = [];
const fail: string[] = [];

function ok(name: string) { pass.push(name); console.log(`  ✓ ${name}`); }
function ko(name: string, err: unknown) {
  fail.push(name);
  console.log(`  ✗ ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
}

/** Espera que la consulta FALLE. Si pasa, la restricción no protege nada. */
async function mustReject(db: PGlite, name: string, sql: string) {
  try {
    await db.exec(sql);
    ko(name, 'la base de datos ACEPTÓ un dato que debería rechazar');
  } catch { ok(name); }
}

async function mustAccept(db: PGlite, name: string, sql: string) {
  try { await db.exec(sql); ok(name); }
  catch (e) { ko(name, e); }
}

async function main() {
  const db = new PGlite();

  console.log('\n▸ Aplicando schema');
  const dir = join(process.cwd(), 'drizzle');
  const migration = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()[0];
  const ddl = readFileSync(join(dir, migration), 'utf8').replace(/--> statement-breakpoint/g, '');

  try {
    await db.exec(ddl);
    ok(`migración ${migration} aplicada`);
  } catch (e) { ko('migración', e); process.exit(1); }

  try {
    await db.exec(readFileSync(join(process.cwd(), 'src/db/init.sql'), 'utf8'));
    ok('init.sql (secuencia + CHECK constraints)');
  } catch (e) { ko('init.sql', e); }

  const [{ count: tables }] = (await db.query<{ count: number }>(
    `select count(*)::int as count from information_schema.tables where table_schema='public'`,
  )).rows;
  ok(`${tables} tablas creadas`);

  console.log('\n▸ Datos base');
  await mustAccept(db, 'roles + usuario + lanzamiento', `
    insert into roles (code, name) values ('owner','Propietario'),('setter','Setter'),('closer','Closer');
    insert into users (id, name, email) values
      ('11111111-1111-1111-1111-111111111111','Álvar','alvar@example.com'),
      ('22222222-2222-2222-2222-222222222222','Iwelo','iwelo@example.com');
    insert into user_roles (user_id, role_code) values
      ('11111111-1111-1111-1111-111111111111','owner'),
      ('11111111-1111-1111-1111-111111111111','setter'),
      ('22222222-2222-2222-2222-222222222222','closer');
    insert into launches (id, name, status, ticket_cents) values
      ('33333333-3333-3333-3333-333333333333','Faceless Sept','active',300000);
    insert into leads (id, launch_id, public_id, full_name, phone_normalized)
      values ('44444444-4444-4444-4444-444444444444',
              '33333333-3333-3333-3333-333333333333',
              'LD-000001','Marcos Ruiz','+34612345678');
  `);

  // Álvar tiene dos roles. Si esto fallara, el modelo de roles sería inservible.
  const [{ n: roleCount }] = (await db.query<{ n: number }>(
    `select count(*)::int as n from user_roles where user_id='11111111-1111-1111-1111-111111111111'`,
  )).rows;
  roleCount === 2
    ? ok('un usuario puede ser Owner Y Setter a la vez')
    : ko('roles múltiples', `esperaba 2 roles, hay ${roleCount}`);

  console.log('\n▸ Integridad que el proyecto promete');

  await mustReject(db, 'un estado de lead inválido se rechaza',
    `insert into leads (launch_id, public_id, full_name, status)
     values ('33333333-3333-3333-3333-333333333333','LD-000099','Test','ganado')`);

  // La reunión se crea en su propio statement: si fuera en el mismo `exec`
  // que un insert que debe fallar, el rollback se la llevaría por delante y
  // las comprobaciones siguientes medirían otra cosa.
  await mustAccept(db, 'Meeting #1 se crea',
    `insert into meetings (id, lead_id, launch_id, meeting_number, scheduled_at)
     values ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444',
             '33333333-3333-3333-3333-333333333333',1, now())`);

  await mustReject(db, 'una venta de importe 0 se rechaza',
    `insert into sales (lead_id, meeting_id, closer_id, launch_id, amount_cents, payment_method, closed_at)
     values ('44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555',
             '22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
             0,'card', now())`);

  await mustReject(db, 'Meeting #1 no se puede duplicar por lead',
    `insert into meetings (lead_id, launch_id, meeting_number, scheduled_at)
     values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',1, now())`);

  await mustAccept(db, 'Meeting #2 sí se crea sin tocar la #1',
    `insert into meetings (lead_id, launch_id, meeting_number, scheduled_at)
     values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',2, now())`);

  await mustAccept(db, 'el mismo booking de Calendly solo entra una vez (1/2)',
    `insert into webhook_events (provider, external_event_id, payload)
     values ('calendly','evt_ABC','{}'::jsonb)`);
  await mustReject(db, 'el mismo booking de Calendly solo entra una vez (2/2)',
    `insert into webhook_events (provider, external_event_id, payload)
     values ('calendly','evt_ABC','{}'::jsonb)`);

  await mustAccept(db, 'el cron no duplica la tarea de confirmación (1/2)',
    `insert into tasks (title, task_type, dedupe_key)
     values ('Confirmar 24h','confirm_meeting_24h','confirm_meeting_24h:55555555')`);
  await mustReject(db, 'el cron no duplica la tarea de confirmación (2/2)',
    `insert into tasks (title, task_type, dedupe_key)
     values ('Confirmar 24h','confirm_meeting_24h','confirm_meeting_24h:55555555')`);

  await mustAccept(db, 'doble click en Ganado no crea dos ventas (1/2)',
    `insert into sales (lead_id, meeting_id, closer_id, launch_id, amount_cents, payment_method, closed_at, idempotency_key)
     values ('44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555',
             '22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
             300000,'card', now(), 'sale:55555555')`);
  await mustReject(db, 'doble click en Ganado no crea dos ventas (2/2)',
    `insert into sales (lead_id, meeting_id, closer_id, launch_id, amount_cents, payment_method, closed_at, idempotency_key)
     values ('44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555',
             '22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
             300000,'card', now(), 'sale:55555555')`);

  await mustAccept(db, 'los reintentos se agrupan sin pisarse (1/2)',
    `insert into setter_calls (lead_id, setter_id, launch_id, call_type, call_group_id, attempt_number)
     values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',
             '33333333-3333-3333-3333-333333333333','post_class_1',
             '66666666-6666-6666-6666-666666666666', 1)`);
  await mustAccept(db, 'los reintentos se agrupan sin pisarse (2/2)',
    `insert into setter_calls (lead_id, setter_id, launch_id, call_type, call_group_id, attempt_number)
     values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',
             '33333333-3333-3333-3333-333333333333','post_class_1',
             '66666666-6666-6666-6666-666666666666', 2)`);
  await mustReject(db, 'el mismo intento no se registra dos veces',
    `insert into setter_calls (lead_id, setter_id, launch_id, call_type, call_group_id, attempt_number)
     values ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',
             '33333333-3333-3333-3333-333333333333','post_class_1',
             '66666666-6666-6666-6666-666666666666', 2)`);

  console.log('\n▸ NULL ≠ false ≠ 0');
  const [{ w }] = (await db.query<{ w: boolean | null }>(
    `select webinar_attended as w from leads where public_id='LD-000001'`,
  )).rows;
  w === null
    ? ok('la asistencia al webinar nace NULL, no false')
    : ko('webinar_attended', `esperaba null, es ${w}`);

  const [{ seq }] = (await db.query<{ seq: string }>(`select nextval('lead_public_seq') as seq`)).rows;
  Number(seq) > 0 ? ok(`secuencia de public_id operativa (siguiente: ${seq})`) : ko('secuencia', seq);

  console.log(`\n${'─'.repeat(58)}`);
  console.log(`${pass.length} comprobaciones correctas · ${fail.length} fallidas`);
  if (fail.length) { fail.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
  console.log('Schema verificado contra Postgres real (PGlite).\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
