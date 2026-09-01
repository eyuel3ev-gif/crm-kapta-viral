/**
 * CRM Álvar · Schema Drizzle
 * Espejo de spec/02-SCHEMA-V0.sql. Si cambias uno, cambia el otro.
 *
 * Reglas que el schema hace cumplir por diseño:
 *   · dinero en céntimos enteros, nunca float
 *   · timestamps con zona, guardados en UTC
 *   · NULL = desconocido, distinto de false y de 0
 *   · estado comercial separado de estado operativo
 */
import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, char, numeric,
  index, uniqueIndex, primaryKey,
} from 'drizzle-orm/pg-core';
import { sql, relations } from 'drizzle-orm';

/* ── 1. LANZAMIENTO ─────────────────────────────────────────────────────── */

export const launches = pgTable('launches', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),

  /**
   * Dos negocios distintos conviviendo en el mismo CRM.
   *
   *   evergreen  siempre abierto. Entra por DM de Instagram, compra en
   *              Hotmart. No hay clases ni directo: no tiene sentido una
   *              "confirmacion del webinar" ni una cola "tras la Clase 1".
   *   launch     tiene calendario. Clases, directo, Calendly y reuniones.
   *
   * Separarlos importa porque mezclar sus metricas miente: un evergreen que
   * vende todo el mes hunde el close rate de un lanzamiento de tres dias, y
   * al reves.
   */
  type: text('type').notNull().default('launch'),   // launch | evergreen
  status: text('status').notNull().default('draft'),      // draft | active | closed
  timezone: text('timezone').notNull().default('Europe/Madrid'),
  currency: char('currency', { length: 3 }).notNull().default('EUR'),
  offerName: text('offer_name'),
  ticketCents: integer('ticket_cents'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Clases y directo. Las automatizaciones se programan RELATIVAS a estos
 *  eventos: si la Clase 1 se mueve, la cola del setter se mueve sola. */
export const launchEvents = pgTable('launch_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  launchId: uuid('launch_id').notNull().references(() => launches.id),
  code: text('code').notNull(),                            // CLASS_1 | WEBINAR_1 ...
  name: text('name').notNull(),
  eventType: text('event_type').notNull(),                 // class | webinar | other
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  metadata: jsonb('metadata').notNull().default({}),
}, (t) => [uniqueIndex('launch_events_launch_code_uq').on(t.launchId, t.code)]);

/* ── 2. USUARIOS Y ROLES ────────────────────────────────────────────────── */

export const roles = pgTable('roles', {
  code: text('code').primaryKey(),                         // owner | setter | closer
  name: text('name').notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  /** scrypt$sal$hash. NULL = el usuario existe pero todavia no puede entrar. */
  passwordHash: text('password_hash'),
  active: boolean('active').notNull().default(true),
  timezone: text('timezone').notNull().default('Europe/Madrid'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  lastAssignedAt: timestamp('last_assigned_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
});

/** Muchos-a-muchos: Álvar es Owner Y Setter. Con 3 personas, todos hacen de todo. */
export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleCode: text('role_code').notNull().references(() => roles.code),
}, (t) => [primaryKey({ columns: [t.userId, t.roleCode] })]);

/* ── 3. LEADS ───────────────────────────────────────────────────────────── */

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  launchId: uuid('launch_id').notNull().references(() => launches.id),
  publicId: text('public_id').notNull().unique(),          // LD-000184

  fullName: text('full_name').notNull(),
  phoneRaw: text('phone_raw'),
  phoneNormalized: text('phone_normalized'),               // E.164
  emailRaw: text('email_raw'),
  emailNormalized: text('email_normalized'),
  city: text('city'),
  country: char('country', { length: 2 }).notNull().default('ES'),

  /* ── Canal de entrada ────────────────────────────────────────────────
   * Un lead que llega por DM de Instagram no tiene formulario ni landing.
   * Guardamos con que identidad llego y un enlace directo a la conversacion,
   * para que el setter la abra donde de verdad esta: en ManyChat o en el
   * propio Instagram. El CRM no duplica la bandeja de entrada, la referencia. */
  channel: text('channel').notNull().default('form'),   // form | instagram_dm | manual
  instagramUsername: text('instagram_username'),
  externalContactId: text('external_contact_id'),       // contacto de ManyChat
  conversationUrl: text('conversation_url'),

  /** Estado COMERCIAL. Una sola dimensión: la del embudo. */
  status: text('status').notNull().default('new'),
  // new | contacted | qualified | disqualified | meeting_scheduled
  // | meeting_held | follow_up | won | lost

  /** Dimensiones OPERATIVAS, separadas a propósito. Mezclarlas impide
   *  distinguir "no me coge el teléfono" de "no encaja". */
  contactStatus: text('contact_status').notNull().default('not_attempted'),
  // not_attempted | attempted | contacted | unreachable
  qualificationStatus: text('qualification_status').notNull().default('not_assessed'),
  // not_assessed | qualified | disqualified
  interestLevel: text('interest_level'),                   // low | medium | high | very_high
  liveConfirmation: text('live_confirmation'),

  /** NULL mientras el acceso al directo sea un enlace genérico de Zoom.
   *  Poner false sería inventar un dato que no tenemos. */
  webinarAttended: boolean('webinar_attended'),

  eligibleForSetter: boolean('eligible_for_setter').notNull().default(false),
  assignedSetterId: uuid('assigned_setter_id').references(() => users.id),
  assignedCloserId: uuid('assigned_closer_id').references(() => users.id),

  nextActionType: text('next_action_type'),
  nextActionAt: timestamp('next_action_at', { withTimezone: true }),

  /** DERIVADO de sales. Se recalcula dentro de la transacción de venta.
   *  Nunca se escribe a mano desde un formulario. */
  revenueCents: integer('revenue_cents').notNull().default(0),
  currency: char('currency', { length: 3 }).notNull().default('EUR'),

  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  qualifiedAt: timestamp('qualified_at', { withTimezone: true }),
  wonAt: timestamp('won_at', { withTimezone: true }),
  lostAt: timestamp('lost_at', { withTimezone: true }),

  mergedIntoLeadId: uuid('merged_into_lead_id'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('leads_launch_registered_idx').on(t.launchId, t.registeredAt),
  index('leads_phone_idx').on(t.phoneNormalized),
  index('leads_email_idx').on(t.emailNormalized),
  index('leads_status_idx').on(t.status),
  index('leads_setter_idx').on(t.assignedSetterId, t.nextActionAt),
  index('leads_closer_idx').on(t.assignedCloserId),
  // Un contacto de ManyChat es una identidad mas: el mismo suscriptor que
  // vuelve a escribir tiene que caer en su ficha, no crear una nueva.
  uniqueIndex('leads_external_contact_uq').on(t.externalContactId),
]);

/** Inmutable por defecto. Solo el Owner la corrige, y queda en Audit Log. */
export const leadAttribution = pgTable('lead_attribution', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  touch: text('touch').notNull().default('first'),         // first | last

  source: text('source').notNull().default('unknown'),     // meta | organic | referral | direct
  medium: text('medium'),
  campaignId: text('campaign_id'),
  campaignName: text('campaign_name'),                     // snapshot: en Meta cambia
  adsetId: text('adset_id'),
  adsetName: text('adset_name'),
  adId: text('ad_id'),
  adName: text('ad_name'),
  creativeId: text('creative_id'),
  creativeName: text('creative_name'),
  placement: text('placement'),

  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  utmContent: text('utm_content'),
  utmTerm: text('utm_term'),

  fbclid: text('fbclid'),
  fbp: text('fbp'),                                        // imprescindibles para CAPI
  fbc: text('fbc'),

  landingUrl: text('landing_url'),
  referrerUrl: text('referrer_url'),
  rawParams: jsonb('raw_params').notNull().default({}),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('lead_attribution_lead_touch_uq').on(t.leadId, t.touch),
  index('lead_attribution_campaign_idx').on(t.campaignId),
  index('lead_attribution_ad_idx').on(t.adId),
]);

/** Se detectan, nunca se fusionan solos por nombre parecido. */
export const leadMergeCandidates = pgTable('lead_merge_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadAId: uuid('lead_a_id').notNull().references(() => leads.id),
  leadBId: uuid('lead_b_id').notNull().references(() => leads.id),
  confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
  method: text('method').notNull(),
  reasons: jsonb('reasons').notNull().default({}),
  status: text('status').notNull().default('pending'),     // pending | merged | rejected
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Enlaces firmados por lead. Resuelven la identificación FUERA del CRM:
 *  sin esto no se sabe quién rellenó el formulario de perfil. */
export const leadTokens = pgTable('lead_tokens', {
  token: text('token').primaryKey(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(),                      // profile_form | whatsapp_group | class
  usedAt: timestamp('used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('lead_tokens_lead_idx').on(t.leadId, t.purpose)]);

/* ── 4. FORMULARIOS VERSIONADOS ─────────────────────────────────────────── */

export const forms = pgTable('forms', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),                   // REGISTRATION | PRECLASS_PROFILE
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
});

export const formVersions = pgTable('form_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  formId: uuid('form_id').notNull().references(() => forms.id),
  version: integer('version').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('form_versions_uq').on(t.formId, t.version)]);

export const formQuestions = pgTable('form_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  formVersionId: uuid('form_version_id').notNull().references(() => formVersions.id),
  code: text('code').notNull(),
  questionText: text('question_text').notNull(),
  fieldType: text('field_type').notNull(),
  required: boolean('required').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  options: jsonb('options'),
}, (t) => [uniqueIndex('form_questions_uq').on(t.formVersionId, t.code)]);

export const formSubmissions = pgTable('form_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  formVersionId: uuid('form_version_id').notNull().references(() => formVersions.id),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  source: text('source'),
  idempotencyKey: text('idempotency_key').unique(),        // bloquea el doble envío
}, (t) => [index('form_submissions_lead_idx').on(t.leadId)]);

export const formAnswers = pgTable('form_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => formSubmissions.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull().references(() => formQuestions.id),
  /** La pregunta EXACTA que vio el lead. Si mañana se reescribe el texto,
   *  la respuesta de ayer sigue significando lo mismo. */
  questionTextSnapshot: text('question_text_snapshot').notNull(),
  answerText: text('answer_text'),
  answerJson: jsonb('answer_json'),
}, (t) => [index('form_answers_submission_idx').on(t.submissionId)]);

/* ── 5. LLAMADAS DEL SETTER ─────────────────────────────────────────────── */

export const setterCallQuestions = pgTable('setter_call_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  callType: text('call_type').notNull(),   // post_class_1 | webinar_confirmation | meeting_24h
  code: text('code').notNull(),
  questionText: text('question_text').notNull(),
  fieldType: text('field_type').notNull().default('textarea'),
  required: boolean('required').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  version: integer('version').notNull().default(1),
  active: boolean('active').notNull().default(true),
}, (t) => [uniqueIndex('setter_call_questions_uq').on(t.callType, t.code, t.version)]);

export const setterCalls = pgTable('setter_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  setterId: uuid('setter_id').notNull().references(() => users.id),
  launchId: uuid('launch_id').notNull().references(() => launches.id),

  callType: text('call_type').notNull(),

  /** Agrupa los reintentos de la MISMA llamada lógica.
   *  Sin esto, 3 intentos al mismo lead cuentan como 3 leads en contact_rate. */
  callGroupId: uuid('call_group_id').notNull(),
  attemptNumber: integer('attempt_number').notNull().default(1),
  parentCallId: uuid('parent_call_id'),

  meetingId: uuid('meeting_id'),

  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  status: text('status').notNull().default('scheduled'),
  answered: boolean('answered'),                           // NULL = aún sin ejecutar
  resultCode: text('result_code'),

  interestLevel: text('interest_level'),
  qualification: text('qualification'),                    // qualified | disqualified
  disqualificationReason: text('disqualification_reason'),
  attendanceIntent: text('attendance_intent'),
  meetingConfirmation: text('meeting_confirmation'),

  notes: text('notes'),
  durationSeconds: integer('duration_seconds'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('setter_calls_group_attempt_uq').on(t.callGroupId, t.attemptNumber),
  index('setter_calls_lead_idx').on(t.leadId, t.createdAt),
  index('setter_calls_setter_idx').on(t.setterId, t.scheduledAt),
]);

export const setterCallAnswers = pgTable('setter_call_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  setterCallId: uuid('setter_call_id').notNull().references(() => setterCalls.id, { onDelete: 'cascade' }),
  questionId: uuid('question_id').notNull().references(() => setterCallQuestions.id),
  questionTextSnapshot: text('question_text_snapshot').notNull(),
  answerText: text('answer_text'),
  answerJson: jsonb('answer_json'),
}, (t) => [index('setter_call_answers_call_idx').on(t.setterCallId)]);

/* ── 6. REUNIONES ───────────────────────────────────────────────────────── */

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  closerId: uuid('closer_id').references(() => users.id),
  launchId: uuid('launch_id').notNull().references(() => launches.id),
  meetingNumber: integer('meeting_number').notNull(),

  externalProvider: text('external_provider'),
  externalBookingId: text('external_booking_id'),          // clave de idempotencia
  eventTypeId: text('event_type_id'),
  timezoneOriginal: text('timezone_original'),

  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),

  /** DOS campos. Una reunión puede estar `completed` con resultado
   *  `follow_up`: son preguntas distintas y no caben en un solo campo. */
  status: text('status').notNull().default('scheduled'),
  // scheduled | completed | no_show | cancelled
  commercialResult: text('commercial_result').notNull().default('pending'),
  // pending | won | lost | follow_up

  confirmation24hStatus: text('confirmation_24h_status'),

  notes: text('notes'),
  /** Enlace a la grabación. Se guarda solo la URL: la transcripción
   *  completa entra cuando toque el diagnóstico IA. */
  phantomUrl: text('phantom_url'),
  recordingUrl: text('recording_url'),

  followUpReason: text('follow_up_reason'),
  followUpAt: timestamp('follow_up_at', { withTimezone: true }),
  nextAction: text('next_action'),

  lossReasonId: uuid('loss_reason_id'),
  lossReasonNotes: text('loss_reason_notes'),

  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  noShowMarkedAt: timestamp('no_show_marked_at', { withTimezone: true }),
  manualReviewRequired: boolean('manual_review_required').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('meetings_lead_number_uq').on(t.leadId, t.meetingNumber),
  uniqueIndex('meetings_external_uq').on(t.externalProvider, t.externalBookingId),
  index('meetings_closer_idx').on(t.closerId, t.scheduledAt),
  index('meetings_lead_idx').on(t.leadId),
  index('meetings_status_idx').on(t.status, t.scheduledAt),
]);

/** Reagendar NO crea reunión nueva: mueve scheduled_at y deja rastro aquí.
 *  Crear una segunda inflaría el show_rate con una cita que nunca existió. */
export const meetingScheduleHistory = pgTable('meeting_schedule_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  oldScheduledAt: timestamp('old_scheduled_at', { withTimezone: true }).notNull(),
  newScheduledAt: timestamp('new_scheduled_at', { withTimezone: true }).notNull(),
  reason: text('reason'),
  changedBy: uuid('changed_by').references(() => users.id),
  actorType: text('actor_type').notNull().default('user'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ── 7. CATÁLOGOS COMERCIALES ───────────────────────────────────────────── */

export const lossReasons = pgTable('loss_reasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** Taxonomía compartida entre el motivo humano y las objeciones de la IA.
 *  Sin enum común, "precio aparece en el 37% de las pérdidas" no se calcula:
 *  el texto libre no se agrega. */
export const objectionTypes = pgTable('objection_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  label: text('label').notNull(),
  active: boolean('active').notNull().default(true),
});

/* ── 8. VENTAS Y COBROS ─────────────────────────────────────────────────── */

export const sales = pgTable('sales', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leads.id),

  /** Nullables a proposito: una compra directa en Hotmart no pasa por una
   *  reunion ni tiene closer. Exigirlos obligaria a inventar una reunion
   *  fantasma para poder registrar la venta, y eso destroza el show rate. */
  meetingId: uuid('meeting_id').references(() => meetings.id),
  closerId: uuid('closer_id').references(() => users.id),
  launchId: uuid('launch_id').notNull().references(() => launches.id),

  /** De donde viene el registro de la venta. Manda para saber que dato es
   *  fiable: lo que dice Hotmart sobre el cobro, o lo que marco el closer. */
  source: text('source').notNull().default('crm'),   // crm | hotmart | manual
  externalId: text('external_id'),                   // transaccion de Hotmart

  amountCents: integer('amount_cents').notNull(),
  currency: char('currency', { length: 3 }).notNull().default('EUR'),
  paymentMethod: text('payment_method').notNull(),

  financingStatus: text('financing_status').notNull().default('not_applicable'),
  // not_applicable | not_requested | requested | approved | rejected | pending
  financingProvider: text('financing_provider'),
  installments: integer('installments'),
  installmentCents: integer('installment_cents'),

  status: text('status').notNull().default('active'),
  // active | refunded | defaulted | corrected | cancelled

  closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
  idempotencyKey: text('idempotency_key').unique(),        // doble click = 1 venta
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('sales_closer_idx').on(t.closerId, t.closedAt),
  index('sales_lead_idx').on(t.leadId),
  // Hotmart reenvia el mismo evento: sin esto, la misma compra entra dos veces.
  uniqueIndex('sales_external_uq').on(t.source, t.externalId),
]);

/** Con ticket de 3.000 € y financiación, el impago no es un caso raro.
 *  Sin esta tabla el revenue miente desde el mes 2, y el ROAS con él. */
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  saleId: uuid('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  currency: char('currency', { length: 3 }).notNull().default('EUR'),
  status: text('status').notNull().default('pending'),     // pending | paid | failed | refunded
  dueAt: timestamp('due_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  installmentNumber: integer('installment_number'),
  externalRef: text('external_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('payments_sale_idx').on(t.saleId, t.dueAt)]);

/* ── 9. TAREAS ──────────────────────────────────────────────────────────── */

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  launchId: uuid('launch_id').references(() => launches.id),
  title: text('title').notNull(),
  description: text('description'),
  /** Por qué existe esta tarea. Una Smart Task sin motivo es ruido. */
  reason: text('reason'),

  taskType: text('task_type').notNull(),
  category: text('category').notNull().default('commercial'),
  priority: text('priority').notNull().default('medium'),
  impact: text('impact'),

  source: text('source').notNull().default('manual'),      // manual | automation
  automationRuleCode: text('automation_rule_code'),

  /** Impide que un cron cada 5 minutos genere 12 tareas idénticas. */
  dedupeKey: text('dedupe_key').unique(),

  status: text('status').notNull().default('pending'),
  // pending | in_progress | completed | cancelled
  // "vencida" NO se guarda: se calcula. Un estado mutable se desincroniza
  // en cuanto alguien mueve la fecha.

  assigneeId: uuid('assignee_id').references(() => users.id),
  createdById: uuid('created_by_id').references(() => users.id),

  relatedLeadId: uuid('related_lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  relatedMeetingId: uuid('related_meeting_id').references(() => meetings.id, { onDelete: 'cascade' }),
  relatedSetterCallId: uuid('related_setter_call_id').references(() => setterCalls.id, { onDelete: 'cascade' }),

  dueAt: timestamp('due_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedBy: uuid('completed_by').references(() => users.id),
  completionOutcome: text('completion_outcome'),
  cancelledReason: text('cancelled_reason'),
  supersededByTaskId: uuid('superseded_by_task_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('tasks_assignee_idx').on(t.assigneeId, t.status, t.dueAt),
  index('tasks_lead_idx').on(t.relatedLeadId),
  index('tasks_due_idx').on(t.status, t.dueAt),
]);

/* ── 10. HISTORIAL ──────────────────────────────────────────────────────── */

/** La historia comercial legible del lead. Se alimenta sola. */
export const leadActivity = pgTable('lead_activity', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  actorType: text('actor_type').notNull().default('system'), // user | system | integration | ai
  actorUserId: uuid('actor_user_id').references(() => users.id),
  metadata: jsonb('metadata').notNull().default({}),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('lead_activity_lead_idx').on(t.leadId, t.occurredAt)]);

/** Trazabilidad técnica de quién cambió qué. NO es lo mismo que Activity Log
 *  y no se pueden fusionar: uno cuenta la historia, el otro la responsabilidad. */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  actorType: text('actor_type').notNull().default('user'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  reason: text('reason'),
  metadata: jsonb('metadata').notNull().default({}),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('audit_entity_idx').on(t.entityType, t.entityId, t.createdAt),
  index('audit_actor_idx').on(t.actorUserId, t.createdAt),
]);

/* ── 11. INTEGRACIONES Y EVENTOS ────────────────────────────────────────── */

/** Idempotencia de webhooks. Calendly reenvía; sin esto se duplican citas. */
export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),
  externalEventId: text('external_event_id').notNull(),
  eventType: text('event_type'),
  payload: jsonb('payload').notNull(),
  payloadHash: text('payload_hash'),
  status: text('status').notNull().default('received'),
  // received | processing | processed | failed | dead_letter
  retryCount: integer('retry_count').notNull().default(0),
  errorMessage: text('error_message'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('webhook_events_uq').on(t.provider, t.externalEventId),
  index('webhook_events_status_idx').on(t.status, t.receivedAt),
]);

/** Outbox transaccional. Se escribe DENTRO de la misma transacción que la
 *  mutación y un worker lo despacha después. De aquí salen el Activity Log,
 *  las Smart Tasks, las notificaciones y (en V1) el CAPI hacia Meta. */
export const domainEvents = pgTable('domain_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventType: text('event_type').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  actorType: text('actor_type').notNull().default('system'),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  payload: jsonb('payload').notNull().default({}),
  correlationId: uuid('correlation_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
}, (t) => [
  index('domain_events_pending_idx').on(t.processedAt, t.occurredAt),
  index('domain_events_lead_idx').on(t.leadId, t.occurredAt),
]);

/** Cadencias, umbrales y ventanas. Cambiarlos NO requiere desplegar. */
export const automationSettings = pgTable('automation_settings', {
  key: text('key').primaryKey(),
  valueJson: jsonb('value_json').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

/* ── RELACIONES ─────────────────────────────────────────────────────────── */

export const leadsRelations = relations(leads, ({ one, many }) => ({
  setter: one(users, { fields: [leads.assignedSetterId], references: [users.id], relationName: 'setter' }),
  closer: one(users, { fields: [leads.assignedCloserId], references: [users.id], relationName: 'closer' }),
  attribution: many(leadAttribution),
  submissions: many(formSubmissions),
  calls: many(setterCalls),
  meetings: many(meetings),
  activity: many(leadActivity),
  tasks: many(tasks),
}));

export const meetingsRelations = relations(meetings, ({ one, many }) => ({
  lead: one(leads, { fields: [meetings.leadId], references: [leads.id] }),
  closer: one(users, { fields: [meetings.closerId], references: [users.id] }),
  lossReason: one(lossReasons, { fields: [meetings.lossReasonId], references: [lossReasons.id] }),
  scheduleHistory: many(meetingScheduleHistory),
}));

export const setterCallsRelations = relations(setterCalls, ({ one, many }) => ({
  lead: one(leads, { fields: [setterCalls.leadId], references: [leads.id] }),
  setter: one(users, { fields: [setterCalls.setterId], references: [users.id] }),
  answers: many(setterCallAnswers),
}));

export const usersRelations = relations(users, ({ many }) => ({
  roles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
}));

/* ── TIPOS ──────────────────────────────────────────────────────────────── */

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type User = typeof users.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type SetterCall = typeof setterCalls.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type LeadActivity = typeof leadActivity.$inferSelect;

export const SQL_HELPERS = { sql };
