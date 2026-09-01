-- ============================================================================
-- CRM ÁLVAR · SCHEMA V0 (PostgreSQL / Supabase)
-- ----------------------------------------------------------------------------
-- Contrato de datos del núcleo operativo. Solo lo que hace falta antes de que
-- entre el primer lead. Analytics, Meta y IA se añaden encima sin tocar esto.
--
-- Convenciones (00-DECISIONES-CERRADAS.md §3):
--   · timestamps SIEMPRE en UTC (timestamptz)
--   · dinero SIEMPRE en céntimos enteros + currency
--   · NULL = desconocido · false = sabemos que no · 0 = cero real
--   · nombres en inglés snake_case; los labels en español viven en el frontend
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. LANZAMIENTO
-- Aunque V0 tiene un solo lanzamiento, launch_id existe desde la primera fila.
-- Sin él, el segundo lanzamiento obliga a migrar toda la base (D5-V2 §52).
-- ============================================================================

create table launches (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  status          text        not null default 'draft'
                  check (status in ('draft','active','closed')),
  timezone        text        not null default 'Europe/Madrid',
  currency        char(3)     not null default 'EUR',
  offer_name      text,
  ticket_cents    integer,                       -- 300000 = 3.000 €
  starts_at       timestamptz,
  ends_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- Clases, directo y demás hitos. Las automatizaciones se programan
-- RELATIVAS a estos eventos, no con fechas escritas a mano en el código.
create table launch_events (
  id              uuid primary key default gen_random_uuid(),
  launch_id       uuid        not null references launches(id),
  code            text        not null,          -- CLASS_1 | CLASS_2 | CLASS_3 | WEBINAR_1
  name            text        not null,
  event_type      text        not null check (event_type in ('class','webinar','other')),
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  metadata        jsonb       not null default '{}',
  unique (launch_id, code)
);

-- ============================================================================
-- 2. USUARIOS Y ROLES
-- Muchos-a-muchos: Álvar es Owner Y Setter (decisión #9).
-- ============================================================================

create table roles (
  code            text primary key,              -- owner | setter | closer
  name            text not null
);
insert into roles (code, name) values
  ('owner','Propietario'), ('setter','Setter'), ('closer','Closer');

create table users (
  id              uuid primary key,              -- = auth.users.id de Supabase
  name            text        not null,
  email           text        not null unique,
  active          boolean     not null default true,
  timezone        text        not null default 'Europe/Madrid',
  last_login_at   timestamptz,
  last_assigned_at timestamptz,                  -- round-robin de leads
  created_at      timestamptz not null default now(),
  disabled_at     timestamptz
);

create table user_roles (
  user_id         uuid not null references users(id) on delete cascade,
  role_code       text not null references roles(code),
  primary key (user_id, role_code)
);

-- ============================================================================
-- 3. LEADS
-- ============================================================================

create sequence lead_public_seq start 1;

create table leads (
  id                    uuid primary key default gen_random_uuid(),
  launch_id             uuid not null references launches(id),
  public_id             text not null unique
                        default 'LD-' || lpad(nextval('lead_public_seq')::text, 6, '0'),

  full_name             text not null,
  phone_raw             text,
  phone_normalized      text,                    -- E.164: +34612345678
  email_raw             text,
  email_normalized      text,                    -- trim + lowercase
  city                  text,
  country               char(2) not null default 'ES',

  -- Estado comercial. Una sola dimensión, la del embudo.
  status                text not null default 'new'
                        check (status in ('new','contacted','qualified','disqualified',
                                          'meeting_scheduled','meeting_held','follow_up',
                                          'won','lost')),

  -- Dimensiones operativas SEPARADAS del estado comercial (D3-V2 §53).
  -- Mezclarlas es el error que impide distinguir "no le pillo" de "no encaja".
  contact_status        text not null default 'not_attempted'
                        check (contact_status in ('not_attempted','attempted','contacted','unreachable')),
  qualification_status  text not null default 'not_assessed'
                        check (qualification_status in ('not_assessed','qualified','disqualified')),
  interest_level        text check (interest_level in ('low','medium','high','very_high')),
  live_confirmation     text check (live_confirmation in ('confirmed','likely','unsure','cannot_attend','no_answer')),

  -- Asistencia real al directo: NULL mientras el acceso sea un enlace genérico
  -- de Zoom. NO es false. Rellenarlo con false sería inventar un dato (D1-V2 §43).
  webinar_attended      boolean,

  eligible_for_setter   boolean not null default false,
  assigned_setter_id    uuid references users(id),
  assigned_closer_id    uuid references users(id),

  next_action_type      text,
  next_action_at        timestamptz,

  -- Campo DERIVADO. Se recalcula dentro de la transacción de venta a partir
  -- de SALES. Jamás se escribe a mano (decisión #7).
  revenue_cents         integer not null default 0,
  currency              char(3) not null default 'EUR',

  registered_at         timestamptz not null default now(),
  qualified_at          timestamptz,
  won_at                timestamptz,
  lost_at               timestamptz,

  merged_into_lead_id   uuid references leads(id),   -- si se fusionó, apunta al canónico
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index on leads (launch_id, registered_at desc);
create index on leads (phone_normalized) where phone_normalized is not null;
create index on leads (email_normalized) where email_normalized is not null;
create index on leads (status);
create index on leads (assigned_setter_id, next_action_at);
create index on leads (assigned_closer_id);
create index on leads (eligible_for_setter) where eligible_for_setter = true;

-- Atribución: INMUTABLE por defecto. Solo el Owner la corrige, con Audit Log.
create table lead_attribution (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references leads(id) on delete cascade,
  touch           text not null default 'first' check (touch in ('first','last')),

  source          text not null default 'unknown',   -- meta | organic | referral | direct | unknown
  medium          text,
  campaign_id     text,
  campaign_name   text,                              -- snapshot: el nombre en Meta cambia
  adset_id        text,
  adset_name      text,
  ad_id           text,
  ad_name         text,
  creative_id     text,
  creative_name   text,
  placement       text,

  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,

  fbclid          text,
  fbp             text,                              -- necesarios para CAPI en V1
  fbc             text,

  landing_url     text,
  referrer_url    text,
  raw_params      jsonb not null default '{}',
  captured_at     timestamptz not null default now(),
  unique (lead_id, touch)
);

create index on lead_attribution (campaign_id);
create index on lead_attribution (adset_id);
create index on lead_attribution (ad_id);

-- Duplicados: se detectan, NUNCA se fusionan solos por nombre parecido.
create table lead_merge_candidates (
  id              uuid primary key default gen_random_uuid(),
  lead_a_id       uuid not null references leads(id),
  lead_b_id       uuid not null references leads(id),
  confidence      numeric(3,2) not null,
  method          text not null,
  reasons         jsonb not null default '{}',
  status          text not null default 'pending'
                  check (status in ('pending','merged','rejected')),
  reviewed_by     uuid references users(id),
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- Enlaces firmados por lead. Resuelven la identificación fuera del CRM:
-- formulario de perfil, grupo de WhatsApp, páginas de clase.
-- Sin esto no se puede saber quién completó el perfil sin volver a hacer matching.
create table lead_tokens (
  token           text primary key,              -- aleatorio, 32+ bytes
  lead_id         uuid not null references leads(id) on delete cascade,
  purpose         text not null,                 -- profile_form | whatsapp_group | class
  used_at         timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index on lead_tokens (lead_id, purpose);

-- ============================================================================
-- 4. FORMULARIOS VERSIONADOS
-- Cambiar una pregunta mañana no puede alterar lo que se respondió ayer.
-- ============================================================================

create table forms (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,          -- REGISTRATION | PRECLASS_PROFILE
  name            text not null,
  active          boolean not null default true
);

create table form_versions (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references forms(id),
  version         integer not null,
  published_at    timestamptz not null default now(),
  unique (form_id, version)
);

create table form_questions (
  id              uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references form_versions(id),
  code            text not null,
  question_text   text not null,
  field_type      text not null
                  check (field_type in ('text','textarea','select','radio','boolean','number')),
  required        boolean not null default false,
  sort_order      integer not null default 0,
  options         jsonb,
  unique (form_version_id, code)
);

create table form_submissions (
  id              uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references form_versions(id),
  lead_id         uuid not null references leads(id) on delete cascade,
  submitted_at    timestamptz not null default now(),
  source          text,
  idempotency_key text unique                    -- bloquea el doble envío
);
create index on form_submissions (lead_id);

create table form_answers (
  id                      uuid primary key default gen_random_uuid(),
  submission_id           uuid not null references form_submissions(id) on delete cascade,
  question_id             uuid not null references form_questions(id),
  question_text_snapshot  text not null,         -- la pregunta EXACTA que vio el lead
  answer_text             text,
  answer_json             jsonb
);
create index on form_answers (submission_id);

-- ============================================================================
-- 5. LLAMADAS DEL SETTER
-- ============================================================================

create table setter_call_questions (
  id              uuid primary key default gen_random_uuid(),
  call_type       text not null
                  check (call_type in ('post_class_1','webinar_confirmation','meeting_24h')),
  code            text not null,
  question_text   text not null,
  field_type      text not null default 'textarea',
  required        boolean not null default false,
  sort_order      integer not null default 0,
  version         integer not null default 1,
  active          boolean not null default true,
  unique (call_type, code, version)
);

create table setter_calls (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references leads(id) on delete cascade,
  setter_id         uuid not null references users(id),
  launch_id         uuid not null references launches(id),

  call_type         text not null
                    check (call_type in ('post_class_1','webinar_confirmation','meeting_24h')),

  -- Agrupa los reintentos de la MISMA llamada lógica (decisión #10).
  -- Sin esto, 3 intentos al mismo lead cuentan como 3 leads en contact_rate.
  call_group_id     uuid not null,
  attempt_number    integer not null default 1,
  parent_call_id    uuid references setter_calls(id),

  meeting_id        uuid,                        -- FK añadida tras crear meetings

  scheduled_at      timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,

  status            text not null default 'scheduled'
                    check (status in ('scheduled','in_progress','completed','cancelled')),
  answered          boolean,                     -- NULL = todavía sin ejecutar
  result_code       text
                    check (result_code in ('answered','no_answer','wrong_number','call_back_later',
                                           'confirmed','not_confirmed','reschedule_request','cancel_request')),

  -- Resultados específicos por tipo de llamada
  interest_level    text check (interest_level in ('low','medium','high','very_high')),
  qualification     text check (qualification in ('qualified','disqualified')),
  disqualification_reason text,
  attendance_intent text check (attendance_intent in ('confirmed','likely','unsure','cannot_attend','no_answer')),
  meeting_confirmation text check (meeting_confirmation in ('confirmed','reschedule_requested','cancelled','uncertain','no_answer')),

  notes             text,
  duration_seconds  integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (call_group_id, attempt_number)
);

create index on setter_calls (lead_id, created_at);
create index on setter_calls (setter_id, scheduled_at);
create index on setter_calls (call_group_id);

create table setter_call_answers (
  id                      uuid primary key default gen_random_uuid(),
  setter_call_id          uuid not null references setter_calls(id) on delete cascade,
  question_id             uuid not null references setter_call_questions(id),
  question_text_snapshot  text not null,
  answer_text             text,
  answer_json             jsonb
);
create index on setter_call_answers (setter_call_id);

-- ============================================================================
-- 6. REUNIONES
-- ============================================================================

create table meetings (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid not null references leads(id) on delete cascade,
  closer_id            uuid references users(id),
  launch_id            uuid not null references launches(id),
  meeting_number       integer not null,

  external_provider    text,                     -- calendly
  external_booking_id  text,                     -- invitee uri: clave de idempotencia
  event_type_id        text,
  timezone_original    text,

  scheduled_at         timestamptz not null,
  started_at           timestamptz,
  ended_at             timestamptz,

  -- DOS campos separados. Una reunión puede estar completed con
  -- resultado follow_up. Meterlo en un solo campo es el error #2.
  status               text not null default 'scheduled'
                       check (status in ('scheduled','completed','no_show','cancelled')),
  commercial_result    text not null default 'pending'
                       check (commercial_result in ('pending','won','lost','follow_up')),

  confirmation_24h_status text
                       check (confirmation_24h_status in ('pending','confirmed','reschedule_requested','cancelled','uncertain','no_answer')),

  notes                text,                     -- notas internas del closer
  phantom_url          text,
  recording_url        text,

  follow_up_reason     text,
  follow_up_at         timestamptz,
  next_action          text,

  loss_reason_id       uuid,                     -- FK abajo
  loss_reason_notes    text,

  cancelled_at         timestamptz,
  no_show_marked_at    timestamptz,
  manual_review_required boolean not null default false,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (lead_id, meeting_number),
  unique (external_provider, external_booking_id)
);

create index on meetings (closer_id, scheduled_at);
create index on meetings (lead_id);
create index on meetings (status, scheduled_at);

alter table setter_calls
  add constraint setter_calls_meeting_fk
  foreign key (meeting_id) references meetings(id) on delete set null;

-- Reagendar NO crea una reunión nueva: actualiza scheduled_at y deja rastro.
-- Crear una segunda reunión inflaría el show_rate (decisión #5).
create table meeting_schedule_history (
  id                uuid primary key default gen_random_uuid(),
  meeting_id        uuid not null references meetings(id) on delete cascade,
  old_scheduled_at  timestamptz not null,
  new_scheduled_at  timestamptz not null,
  reason            text,
  changed_by        uuid references users(id),
  actor_type        text not null default 'user' check (actor_type in ('user','system','integration')),
  changed_at        timestamptz not null default now()
);

create table meeting_transcripts (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid not null unique references meetings(id) on delete cascade,
  raw_text            text not null,
  source              text not null default 'manual_phantom',
  source_url          text,
  language            text default 'es',
  version             integer not null default 1,
  imported_by         uuid references users(id),
  imported_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ============================================================================
-- 7. CATÁLOGOS COMERCIALES
-- ============================================================================

create table loss_reasons (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  label     text not null,
  active    boolean not null default true,
  sort_order integer not null default 0
);
insert into loss_reasons (code, label, sort_order) values
  ('price','Precio',1),
  ('financing_rejected','Financiación rechazada',2),
  ('no_time','No tiene tiempo',3),
  ('no_trust','No confía',4),
  ('not_priority','No es prioridad',5),
  ('needs_consult','Debe consultarlo',6),
  ('unqualified','No cualificado',7),
  ('competitor','Competencia',8),
  ('bad_fit','No encaja con el programa',9),
  ('other','Otro',99);

alter table meetings
  add constraint meetings_loss_reason_fk
  foreign key (loss_reason_id) references loss_reasons(id);

-- Taxonomía compartida entre el motivo humano y las objeciones que devuelve
-- la IA. Sin enum común, "el precio aparece en el 37% de las pérdidas" no se
-- puede calcular: el texto libre no se agrega.
create table objection_types (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  label     text not null,
  active    boolean not null default true
);
insert into objection_types (code, label) values
  ('price','Precio'), ('timing','Momento'), ('trust_program','No confía en el programa'),
  ('trust_self','No confía en sí mismo'), ('time_availability','Falta de tiempo'),
  ('spouse_partner','Debe consultarlo'), ('financing','Financiación'),
  ('needs_more_info','Necesita más información'), ('other','Otra');

-- ============================================================================
-- 8. VENTAS Y COBROS
-- El revenue vive AQUÍ. Nunca se calcula sumando reuniones (D4-V2 §51).
-- ============================================================================

create table sales (
  id                uuid primary key default gen_random_uuid(),
  lead_id           uuid not null references leads(id),
  meeting_id        uuid not null references meetings(id),
  closer_id         uuid not null references users(id),
  launch_id         uuid not null references launches(id),

  amount_cents      integer not null check (amount_cents > 0),
  currency          char(3) not null default 'EUR',
  payment_method    text not null,               -- card | transfer | financing | other

  financing_status  text not null default 'not_applicable'
                    check (financing_status in ('not_applicable','not_requested','requested',
                                                'approved','rejected','pending')),
  financing_provider text,
  installments       integer,
  installment_cents  integer,

  status            text not null default 'active'
                    check (status in ('active','refunded','defaulted','corrected','cancelled')),

  closed_at         timestamptz not null,
  idempotency_key   text unique,                 -- doble click en "Ganado" = 1 venta
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on sales (closer_id, closed_at);
create index on sales (lead_id);

-- Con ticket de 3.000 € y financiación, el impago no es un caso raro.
-- Sin esta tabla, revenue miente desde el mes 2 y el ROAS con él.
create table payments (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references sales(id) on delete cascade,
  amount_cents  integer not null,
  currency      char(3) not null default 'EUR',
  status        text not null default 'pending'
                check (status in ('pending','paid','failed','refunded')),
  due_at        timestamptz,
  paid_at       timestamptz,
  installment_number integer,
  external_ref  text,
  created_at    timestamptz not null default now()
);
create index on payments (sale_id, due_at);

-- ============================================================================
-- 9. TAREAS
-- ============================================================================

create table tasks (
  id                   uuid primary key default gen_random_uuid(),
  launch_id            uuid references launches(id),
  title                text not null,
  description          text,
  reason               text,                     -- por qué existe esta tarea (D2 §20)

  task_type            text not null,            -- call_1 | call_1_retry | confirm_live |
                                                 -- confirm_meeting_24h | meeting_result |
                                                 -- follow_up | manual
  category             text not null default 'commercial',
  priority             text not null default 'medium'
                       check (priority in ('low','medium','high','critical')),
  impact               text check (impact in ('low','medium','high','critical')),

  source               text not null default 'manual'
                       check (source in ('manual','automation')),
  automation_rule_code text,

  -- Impide que un cron cada 5 min genere 12 tareas idénticas.
  dedupe_key           text unique,              -- confirm_meeting_24h:{meeting_id}

  status               text not null default 'pending'
                       check (status in ('pending','in_progress','completed','cancelled')),

  assignee_id          uuid references users(id),
  created_by_id        uuid references users(id),

  related_lead_id      uuid references leads(id) on delete cascade,
  related_meeting_id   uuid references meetings(id) on delete cascade,
  related_setter_call_id uuid references setter_calls(id) on delete cascade,

  due_at               timestamptz,
  completed_at         timestamptz,
  completed_by         uuid references users(id),
  completion_outcome   text,
  cancelled_reason     text,
  superseded_by_task_id uuid references tasks(id),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- "Vencida" NO es un estado guardado: se calcula. Un estado mutable se
-- desincroniza en cuanto alguien cambia la fecha (D5 §35).
create index on tasks (assignee_id, status, due_at);
create index on tasks (related_lead_id);
create index on tasks (status, due_at) where status in ('pending','in_progress');

-- ============================================================================
-- 10. HISTORIAL
-- Activity Log = la historia comercial legible del lead.
-- Audit Log    = la trazabilidad técnica de quién cambió qué.
-- No son lo mismo y no se pueden fusionar (D5-V2 §78).
-- ============================================================================

create table lead_activity (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references leads(id) on delete cascade,
  event_type      text not null,
  title           text not null,
  description     text,
  actor_type      text not null default 'system'
                  check (actor_type in ('user','system','integration','ai')),
  actor_user_id   uuid references users(id),
  metadata        jsonb not null default '{}',
  occurred_at     timestamptz not null default now()
);
create index on lead_activity (lead_id, occurred_at desc);

create table audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid references users(id),
  actor_type      text not null default 'user',
  action          text not null,
  entity_type     text not null,
  entity_id       uuid not null,
  old_values      jsonb,
  new_values      jsonb,
  reason          text,
  metadata        jsonb not null default '{}',
  ip_address      inet,
  created_at      timestamptz not null default now()
);
create index on audit_log (entity_type, entity_id, created_at desc);
create index on audit_log (actor_user_id, created_at desc);

-- ============================================================================
-- 11. INTEGRACIONES Y EVENTOS
-- ============================================================================

-- Idempotencia de webhooks. Calendly reenvía; sin esta tabla se duplican citas.
create table webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,               -- calendly | landing_form
  external_event_id text not null,
  event_type        text,
  payload           jsonb not null,
  payload_hash      text,
  status            text not null default 'received'
                    check (status in ('received','processing','processed','failed','dead_letter')),
  retry_count       integer not null default 0,
  error_message     text,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  unique (provider, external_event_id)
);
create index on webhook_events (status, received_at);

-- Outbox transaccional. Se escribe DENTRO de la misma transacción que la
-- mutación; un worker lo despacha después. De aquí salen el Activity Log,
-- las Smart Tasks, las notificaciones y (en V1) el CAPI hacia Meta.
create table domain_events (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null,                 -- lead.qualified | meeting.booked | sale.won ...
  entity_type     text not null,
  entity_id       uuid not null,
  lead_id         uuid references leads(id) on delete cascade,
  actor_type      text not null default 'system',
  actor_user_id   uuid references users(id),
  payload         jsonb not null default '{}',
  correlation_id  uuid,
  occurred_at     timestamptz not null default now(),
  processed_at    timestamptz,
  attempts        integer not null default 0,
  last_error      text
);
create index on domain_events (processed_at, occurred_at) where processed_at is null;
create index on domain_events (lead_id, occurred_at);

-- Cadencias, umbrales y ventanas horarias. Cambiarlos NO requiere desplegar.
create table automation_settings (
  key             text primary key,
  value_json      jsonb not null,
  description     text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references users(id)
);

insert into automation_settings (key, value_json, description) values
  ('setter_retry_policy',
   '{"max_attempts":3,"first_retry_minutes":180,"second_retry_strategy":"next_day","second_retry_hour":11}',
   'Reintentos de Setter Call #1'),
  ('call_1_window',
   '{"hours_after_class_1":6,"start_hour":15,"end_hour":21}',
   'Cuándo se abre la cola de Call #1 respecto a CLASS_1'),
  ('confirmation_24h_window',
   '{"lookahead_hours":24,"lookbehind_hours":25}',
   'Ventana del cron que genera la confirmación de 24h'),
  ('cancellation_grace_hours',
   '{"hours":2}',
   'Cancelar con menos margen que esto cuenta como no-show en el show_rate'),
  ('live_confirmation_segment',
   '{"qualified_only":true,"min_interest":"medium"}',
   'A quién se llama para confirmar el directo');

-- ============================================================================
-- FIN SCHEMA V0
-- Fuera de este fichero, por diseño: meta_*, ai_diagnostics, reports,
-- notifications, alerts. Se añaden en V1/V2 sin tocar ninguna tabla de aquí.
-- ============================================================================
