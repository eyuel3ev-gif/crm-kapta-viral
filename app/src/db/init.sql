-- Lo que drizzle-kit push no crea a partir del schema TypeScript.
-- Se ejecuta después de `npm run db:push`, desde `npm run db:seed`.

-- Numeración pública de leads: LD-000184.
-- Una secuencia, no un count(*): con dos altas simultáneas, el count
-- devuelve el mismo número a las dos.
create sequence if not exists lead_public_seq start 1;

-- CHECK constraints. Drizzle los declara en el SQL de referencia pero no los
-- genera desde el schema TS; sin ellos, un bug puede escribir 'ganado' en un
-- campo que espera 'won' y nadie se entera hasta que falla un informe.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_status_check') then
    alter table leads add constraint leads_status_check check (status in (
      'new','contacted','qualified','disqualified','meeting_scheduled',
      'meeting_held','follow_up','won','lost'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'leads_contact_status_check') then
    alter table leads add constraint leads_contact_status_check check (contact_status in (
      'not_attempted','attempted','contacted','unreachable'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'leads_qualification_check') then
    alter table leads add constraint leads_qualification_check check (qualification_status in (
      'not_assessed','qualified','disqualified'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'meetings_status_check') then
    alter table meetings add constraint meetings_status_check check (status in (
      'scheduled','completed','no_show','cancelled'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'meetings_result_check') then
    alter table meetings add constraint meetings_result_check check (commercial_result in (
      'pending','won','lost','follow_up'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sales_amount_check') then
    alter table sales add constraint sales_amount_check check (amount_cents > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_status_check') then
    alter table tasks add constraint tasks_status_check check (status in (
      'pending','in_progress','completed','cancelled'));
  end if;
end $$;
