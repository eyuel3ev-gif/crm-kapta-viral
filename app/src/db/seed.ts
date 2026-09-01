/**
 * Datos de ejemplo.
 *
 * Crea un lanzamiento completo con leads repartidos por TODO el embudo:
 * no contactables tras tres intentos, cualificados sin próxima acción,
 * reuniones sin resultado, seguimientos vencidos, no-shows y ventas
 * financiadas a plazos.
 *
 * No es relleno: sin volumen y sin casos raros, cada pantalla se prueba vacía
 * y no se ve si aguanta la realidad. Las tablas que se rompen y los ratios
 * absurdos solo aparecen con datos que se parecen a los de verdad.
 *
 * Funciona con Postgres real y con PGlite: solo usa Drizzle y SQL estándar.
 */
import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import * as s from './schema';
import { hashPassword } from '../lib/password';

/* Generador determinista: el mismo seed produce siempre los mismos datos,
   así que un bug encontrado hoy se reproduce mañana. */
let rngState = 42;
const rnd = () => { rngState = (rngState * 1103515245 + 12345) % 2147483648; return rngState / 2147483648; };
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000);

const NOMBRES = ['Marcos Ruiz','Lucía Fernández','Pablo Gómez','Ana Torres','Javier Molina','Carmen Ortiz','Sergio Navarro','Elena Ramos','Daniel Castro','Marta Sanz','Rubén Delgado','Paula Iglesias','Adrián Vega','Sara Herrero','Iván Márquez','Nuria Pascual','Óscar Lorenzo','Beatriz Cano','Hugo Serrano','Cristina Prieto','Álex Rubio','Laura Méndez','Diego Peña','Irene Gallego','Víctor Aguilar','Alba Santos','Raúl Campos','Silvia Rey','Jorge Nieto','Patricia Bravo','Tomás Vidal','Rocío Cabrera','Andrés Soler','Clara Benítez','Gonzalo Marín','Eva Lozano','Mario Esteban','Natalia Fuentes','Rodrigo Cortés','Lidia Arias','Emilio Pardo','Sonia Bermúdez','Nacho Villar','Miriam Cuesta','Guillermo Rosa','Teresa Nogales','Fran Aparicio','Ainhoa Vargas','Luis Miralles','Rosa Company','Borja Escudero','Julia Tomás','Kevin Otero','Noelia Ferrer','Samuel Bustos','Lorena Gil','Ismael Ponce','Claudia Rivas','Aitor Zamora','Vega Salas'];

const OBJETIVOS = ['Generar 2.000 €/mes adicionales','Dejar mi trabajo en 12 meses','Crear un ingreso pasivo','Montar un canal y venderlo','Sustituir mi sueldo actual','Tener libertad para viajar'];
const BLOQUEOS = ['No sé qué nicho elegir','No tengo tiempo suficiente','No sé editar vídeo','Me da miedo invertir y fallar','Empecé un canal y lo abandoné','No sé cómo monetizar'];
const SITUACIONES = ['Trabajo a jornada completa','Autónomo con poco tiempo','Estudiante','En paro buscando algo','Tengo turnos rotativos','Trabajo desde casa'];
const EXPERIENCIA = ['Nunca he empezado','Probé un canal y lo dejé','He visto mucho contenido pero nada hecho','Tengo un canal con 200 subs','He hecho cursos pero no ejecuté'];
const TIEMPO = ['2–4 horas semanales','5–8 horas semanales','10+ horas semanales','Fines de semana'];

const CAMPAIGNS = [
  { id: '120210001', name: 'Faceless Launch · Frío', ads: [{ id: '238100441', name: 'AD_01 · Hook sin cara' }, { id: '238100442', name: 'AD_02 · Testimonio' }] },
  { id: '120210002', name: 'Faceless Launch · Retargeting', ads: [{ id: '238100443', name: 'AD_03 · Objeción tiempo' }] },
];

const TRUNCATE = `truncate table
  form_answers, form_submissions, form_questions, form_versions, forms,
  setter_call_answers, setter_calls, setter_call_questions,
  meeting_schedule_history, payments, sales, meetings,
  tasks, lead_activity, audit_log, domain_events, webhook_events,
  lead_tokens, lead_merge_candidates, lead_attribution, leads,
  launch_events, launches, automation_settings, loss_reasons, objection_types,
  user_roles, users, roles
restart identity cascade`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function seed(db: any, opts: { quiet?: boolean; initialPassword?: string } = {}) {
  const log = (m: string) => { if (!opts.quiet) console.log(m); };

  rngState = 42;
  await db.execute(sql.raw(TRUNCATE));
  await db.execute(sql.raw('alter sequence lead_public_seq restart with 1'));

  /* ── Roles y equipo ────────────────────────────────────────────────── */
  await db.insert(s.roles).values([
    { code: 'owner', name: 'Propietario' },
    { code: 'setter', name: 'Setter' },
    { code: 'closer', name: 'Closer' },
  ]);

  // Contraseña inicial común, pensada para cambiarse el primer día.
  // Cada persona la cambia con: npm run user:password -- email nueva-clave
  const initial = await hashPassword(opts.initialPassword ?? 'CambiarEsto2026!');

  const [alvar, eyuel, ryan, dario, angel] = await db.insert(s.users).values([
    { name: 'Álvar Sola', email: 'alvar@kaptaviral.com', passwordHash: initial },
    { name: 'Eyuel', email: 'eyuel@kaptaviral.com', passwordHash: initial },
    { name: 'Ryan', email: 'ryan@kaptaviral.com', passwordHash: initial },
    { name: 'Darío', email: 'dario@kaptaviral.com', passwordHash: initial },
    { name: 'Ángel', email: 'angel@kaptaviral.com', passwordHash: initial },
  ]).returning();

  await db.insert(s.userRoles).values([
    { userId: alvar.id, roleCode: 'owner' },
    { userId: eyuel.id, roleCode: 'owner' },
    { userId: ryan.id, roleCode: 'owner' },
    { userId: dario.id, roleCode: 'closer' },
    { userId: angel.id, roleCode: 'setter' },
  ]);

  // Hoy solo hay un setter y un closer. El reparto es round-robin sobre la
  // lista de activos, asi que anadir a alguien no toca ni una linea de codigo.
  const iwelo = dario;

  /* ── Lanzamiento ───────────────────────────────────────────────────── */
  const [launch] = await db.insert(s.launches).values({
    name: 'Faceless · Septiembre 2026',
    type: 'launch',
    status: 'active',
    offerName: 'YouTube Faceless 1:1',
    ticketCents: 300_000,
    startsAt: daysAgo(14),
    endsAt: hoursFromNow(24 * 20),
  }).returning();

  await db.insert(s.launchEvents).values([
    { launchId: launch.id, code: 'CLASS_1', name: 'Clase 1', eventType: 'class', startsAt: daysAgo(6) },
    { launchId: launch.id, code: 'CLASS_2', name: 'Clase 2', eventType: 'class', startsAt: daysAgo(5) },
    { launchId: launch.id, code: 'CLASS_3', name: 'Clase 3', eventType: 'class', startsAt: daysAgo(4) },
    { launchId: launch.id, code: 'WEBINAR_1', name: 'Directo', eventType: 'webinar', startsAt: daysAgo(3) },
  ]);

  // El segundo negocio: siempre abierto, sin clases ni directo.
  const [evergreen] = await db.insert(s.launches).values({
    name: 'Kapta Viral · Evergreen',
    type: 'evergreen',
    status: 'active',
    offerName: 'Faceless Academy',
    ticketCents: 149_700,
  }).returning();

  /* ── Catálogos ─────────────────────────────────────────────────────── */
  const lossReasons = await db.insert(s.lossReasons).values([
    { code: 'price', label: 'Precio', sortOrder: 1 },
    { code: 'financing_rejected', label: 'Financiación rechazada', sortOrder: 2 },
    { code: 'no_time', label: 'No tiene tiempo', sortOrder: 3 },
    { code: 'no_trust', label: 'No confía', sortOrder: 4 },
    { code: 'not_priority', label: 'No es prioridad', sortOrder: 5 },
    { code: 'needs_consult', label: 'Debe consultarlo', sortOrder: 6 },
    { code: 'unqualified', label: 'No cualificado', sortOrder: 7 },
    { code: 'competitor', label: 'Competencia', sortOrder: 8 },
    { code: 'bad_fit', label: 'No encaja con el programa', sortOrder: 9 },
    { code: 'other', label: 'Otro', sortOrder: 99 },
  ]).returning();

  await db.insert(s.objectionTypes).values([
    { code: 'price', label: 'Precio' }, { code: 'timing', label: 'Momento' },
    { code: 'trust_program', label: 'No confía en el programa' },
    { code: 'trust_self', label: 'No confía en sí mismo' },
    { code: 'time_availability', label: 'Falta de tiempo' },
    { code: 'spouse_partner', label: 'Debe consultarlo' },
    { code: 'financing', label: 'Financiación' },
    { code: 'needs_more_info', label: 'Necesita más información' },
    { code: 'other', label: 'Otra' },
  ]);

  await db.insert(s.automationSettings).values([
    { key: 'setter_retry_policy', valueJson: { max_attempts: 3, first_retry_minutes: 180, second_retry_strategy: 'next_day', second_retry_hour: 11 }, description: 'Reintentos de Call #1' },
    { key: 'call_1_window', valueJson: { hours_after_class_1: 6, start_hour: 15, end_hour: 21 }, description: 'Ventana de la cola de Call #1' },
    { key: 'confirmation_24h_window', valueJson: { lookahead_hours: 24, lookbehind_hours: 25 }, description: 'Ventana del cron de confirmación' },
    { key: 'cancellation_grace_hours', valueJson: { hours: 2 }, description: 'Margen para que una cancelación no cuente como no-show' },
    { key: 'live_confirmation_segment', valueJson: { qualified_only: true, min_interest: 'medium' }, description: 'A quién se llama para confirmar el directo' },
  ]);

  /* ── Formularios versionados ───────────────────────────────────────── */
  const [regForm, profileForm] = await db.insert(s.forms).values([
    { code: 'REGISTRATION', name: 'Formulario de registro' },
    { code: 'PRECLASS_PROFILE', name: 'Formulario de perfil' },
  ]).returning();

  const [regV1, profV1] = await db.insert(s.formVersions).values([
    { formId: regForm.id, version: 1 },
    { formId: profileForm.id, version: 1 },
  ]).returning();

  await db.insert(s.formQuestions).values([
    { formVersionId: regV1.id, code: 'name', questionText: '¿Cómo te llamas?', fieldType: 'text', required: true, sortOrder: 1 },
    { formVersionId: regV1.id, code: 'whatsapp', questionText: '¿Cuál es tu WhatsApp?', fieldType: 'text', required: true, sortOrder: 2 },
    { formVersionId: regV1.id, code: 'email', questionText: 'Tu email', fieldType: 'text', sortOrder: 3 },
  ]);

  const profileQs = await db.insert(s.formQuestions).values([
    { formVersionId: profV1.id, code: 'situation', questionText: '¿Cuál es tu situación actual?', fieldType: 'select', sortOrder: 1 },
    { formVersionId: profV1.id, code: 'experience', questionText: '¿Qué experiencia tienes con YouTube?', fieldType: 'textarea', sortOrder: 2 },
    { formVersionId: profV1.id, code: 'goal', questionText: '¿Cuál es tu objetivo principal?', fieldType: 'textarea', sortOrder: 3 },
    { formVersionId: profV1.id, code: 'blocker', questionText: '¿Qué es lo que más te está frenando?', fieldType: 'textarea', sortOrder: 4 },
    { formVersionId: profV1.id, code: 'time', questionText: '¿Cuánto tiempo puedes dedicarle a la semana?', fieldType: 'select', sortOrder: 5 },
  ]).returning();

  /* ── Preguntas de las llamadas ─────────────────────────────────────── */
  const callQs = await db.insert(s.setterCallQuestions).values([
    { callType: 'post_class_1', code: 'trigger', questionText: '¿Qué te hizo apuntarte a este entrenamiento ahora?', required: true, sortOrder: 1 },
    { callType: 'post_class_1', code: 'youtube_status', questionText: '¿En qué punto estás ahora mismo con YouTube? ¿Has probado algo antes?', required: true, sortOrder: 2 },
    { callType: 'post_class_1', code: 'desired_outcome', questionText: '¿Qué te gustaría conseguir durante los próximos meses?', required: true, sortOrder: 3 },
    { callType: 'post_class_1', code: 'main_blocker', questionText: '¿Qué es lo que más te está frenando para conseguirlo por tu cuenta?', required: true, sortOrder: 4 },
    { callType: 'post_class_1', code: 'weekly_time', questionText: '¿Cuánto tiempo real podrías dedicarle cada semana?', required: true, sortOrder: 5 },
    { callType: 'post_class_1', code: 'prior_attempts', questionText: '¿Has intentado ya algún curso o método? ¿Qué ocurrió?', sortOrder: 6 },
    { callType: 'post_class_1', code: 'implementation_intent', questionText: 'Si vieras una estructura clara y acompañamiento, ¿tendrías intención real de empezar ahora o estás investigando?', required: true, sortOrder: 7 },
    // Pregunta económica: existe, desactivada. Se enciende sin desplegar.
    { callType: 'post_class_1', code: 'decision_maker', questionText: '¿Tomas tú la decisión de invertir o hay otra persona involucrada?', sortOrder: 8, active: false },

    { callType: 'webinar_confirmation', code: 'training_followed', questionText: '¿Has podido seguir lo que Álvar ha compartido hasta ahora?', sortOrder: 1 },
    { callType: 'webinar_confirmation', code: 'knows_date', questionText: '¿Tienes claro cuándo es el directo?', sortOrder: 2 },
    { callType: 'webinar_confirmation', code: 'can_attend', questionText: '¿Crees que podrás conectarte?', required: true, sortOrder: 3 },
    { callType: 'webinar_confirmation', code: 'pre_live_question', questionText: '¿Hay alguna duda concreta que te gustaría que se resolviera?', sortOrder: 4 },

    { callType: 'meeting_24h', code: 'availability', questionText: '¿Confirmamos que sigues disponible para la reunión de mañana?', required: true, sortOrder: 1 },
    { callType: 'meeting_24h', code: 'meeting_main_goal', questionText: '¿Qué es lo principal que quieres resolver o entender en esa reunión?', required: true, sortOrder: 2 },
    { callType: 'meeting_24h', code: 'desired_result', questionText: '¿Qué resultado te gustaría conseguir si esto encaja contigo?', sortOrder: 3 },
    { callType: 'meeting_24h', code: 'pre_meeting_blocker', questionText: '¿Hay alguna duda o freno que pueda hacer que no avances aunque veas que encaja?', sortOrder: 4 },
    { callType: 'meeting_24h', code: 'decision_participants', questionText: '¿Hay otra persona que necesite participar en la decisión?', sortOrder: 5 },
    { callType: 'meeting_24h', code: 'readiness', questionText: 'Si ves claro el plan, ¿estás en posición de tomar una decisión en la reunión?', sortOrder: 6 },
  ]).returning();

  const call1Qs = callQs.filter((q: { callType: string; active: boolean }) =>
    q.callType === 'post_class_1' && q.active);

  /* ── Leads ─────────────────────────────────────────────────────────── */
  const setters = [angel.id];
  let seq = 0;
  const stats = { qualified: 0, meetings: 0, sales: 0, unreachable: 0 };

  for (let i = 0; i < NOMBRES.length; i++) {
    const name = NOMBRES[i];
    const registeredAt = daysAgo(14 - Math.floor(rnd() * 13));
    const setterId = setters[i % setters.length];
    seq++;

    const campaign = pick(CAMPAIGNS);
    const ad = pick(campaign.ads);
    const isOrganic = chance(0.15);
    const slug = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '.');

    const [lead] = await db.insert(s.leads).values({
      launchId: launch.id,
      publicId: `LD-${String(seq).padStart(6, '0')}`,
      fullName: name,
      phoneRaw: `6${String(10_000_000 + Math.floor(rnd() * 89_999_999))}`,
      phoneNormalized: `+346${String(10_000_000 + Math.floor(rnd() * 89_999_999))}`,
      emailRaw: `${slug}@example.com`,
      emailNormalized: `${slug}@example.com`,
      assignedSetterId: setterId,
      eligibleForSetter: true,
      registeredAt,
      status: 'new',
    }).returning();

    await db.insert(s.leadAttribution).values({
      leadId: lead.id, touch: 'first',
      source: isOrganic ? 'organic' : 'meta',
      campaignId: isOrganic ? null : campaign.id,
      campaignName: isOrganic ? null : campaign.name,
      adId: isOrganic ? null : ad.id,
      adName: isOrganic ? null : ad.name,
      utmSource: isOrganic ? 'youtube' : 'meta',
      fbp: isOrganic ? null : `fb.1.${Date.now()}.${Math.floor(rnd() * 1e9)}`,
      capturedAt: registeredAt,
    });

    await db.insert(s.leadActivity).values({
      leadId: lead.id, eventType: 'LEAD_CREATED', title: 'Lead registrado',
      description: isOrganic ? 'Origen orgánico' : `Campaña: ${campaign.name} · ${ad.name}`,
      occurredAt: registeredAt,
    });

    if (chance(0.85)) {
      const [sub] = await db.insert(s.formSubmissions).values({
        formVersionId: profV1.id, leadId: lead.id, source: 'landing',
        submittedAt: new Date(registeredAt.getTime() + 3600_000),
      }).returning();

      const vals: Record<string, string> = {
        situation: pick(SITUACIONES), experience: pick(EXPERIENCIA),
        goal: pick(OBJETIVOS), blocker: pick(BLOQUEOS), time: pick(TIEMPO),
      };
      for (const q of profileQs) {
        await db.insert(s.formAnswers).values({
          submissionId: sub.id, questionId: q.id,
          questionTextSnapshot: q.questionText, answerText: vals[q.code],
        });
      }
    }

    const callGroupId = randomUUID();
    const answersCall = chance(0.68);
    const call1At = new Date(registeredAt.getTime() + 2 * 86400_000);

    if (!answersCall) {
      // No contesta: hasta 3 intentos y luego "no contactable".
      // NUNCA "no cualificado": no hemos llegado a hablar con él.
      const attempts = 1 + Math.floor(rnd() * 3);
      for (let a = 1; a <= attempts; a++) {
        const at = new Date(call1At.getTime() + (a - 1) * 3 * 3600_000);
        await db.insert(s.setterCalls).values({
          leadId: lead.id, setterId, launchId: launch.id,
          callType: 'post_class_1', callGroupId, attemptNumber: a,
          scheduledAt: at, completedAt: at,
          status: 'completed', answered: false, resultCode: 'no_answer',
        });
        await db.insert(s.leadActivity).values({
          leadId: lead.id, eventType: 'SETTER_CALL_NO_ANSWER',
          title: `Llamada #1 · intento ${a} · no contesta`, occurredAt: at,
        });
      }
      if (attempts >= 3) {
        await db.update(s.leads).set({ contactStatus: 'unreachable' }).where(eq(s.leads.id, lead.id));
        stats.unreachable++;
      } else {
        await db.update(s.leads).set({ contactStatus: 'attempted' }).where(eq(s.leads.id, lead.id));
        await db.insert(s.tasks).values({
          launchId: launch.id, title: `Reintentar llamada · ${name}`,
          reason: `Intento ${attempts} sin respuesta. Reintento programado.`,
          taskType: 'call_1_retry', source: 'automation', automationRuleCode: 'RETRY_SETTER_CALL',
          dedupeKey: `retry:${callGroupId}:${attempts + 1}`,
          assigneeId: setterId, dueAt: hoursFromNow(-2 + rnd() * 8),
          priority: 'high', relatedLeadId: lead.id,
        });
      }
      continue;
    }

    const qualified = chance(0.62);
    const interest = qualified ? pick(['medium', 'high', 'very_high']) : pick(['low', 'medium']);

    const [call] = await db.insert(s.setterCalls).values({
      leadId: lead.id, setterId, launchId: launch.id,
      callType: 'post_class_1', callGroupId, attemptNumber: 1,
      scheduledAt: call1At, completedAt: call1At,
      status: 'completed', answered: true, resultCode: 'answered',
      interestLevel: interest,
      qualification: qualified ? 'qualified' : 'disqualified',
      disqualificationReason: qualified ? null : pick(['Sin interés real', 'Sin tiempo', 'Busca solo información gratuita', 'Perfil no encaja']),
      notes: qualified ? 'Encaja bien. Tiene objetivo concreto y tiempo real.' : 'No hay intención real de implementar.',
    }).returning();

    for (const q of call1Qs) {
      await db.insert(s.setterCallAnswers).values({
        setterCallId: call.id, questionId: q.id,
        questionTextSnapshot: q.questionText,
        answerText: q.code === 'desired_outcome' ? pick(OBJETIVOS)
          : q.code === 'main_blocker' ? pick(BLOQUEOS)
          : q.code === 'weekly_time' ? pick(TIEMPO)
          : q.code === 'youtube_status' ? pick(EXPERIENCIA)
          : 'Respuesta registrada por el setter.',
      });
    }

    await db.insert(s.leadActivity).values([
      { leadId: lead.id, eventType: 'SETTER_CALL_COMPLETED', title: 'Llamada #1 completada', occurredAt: call1At },
      { leadId: lead.id, eventType: qualified ? 'LEAD_QUALIFIED' : 'LEAD_DISQUALIFIED',
        title: qualified ? `Cualificado · interés ${interest}` : 'No cualificado',
        occurredAt: new Date(call1At.getTime() + 300_000) },
    ]);

    if (!qualified) {
      await db.update(s.leads).set({
        contactStatus: 'contacted', qualificationStatus: 'disqualified',
        interestLevel: interest, status: 'disqualified',
      }).where(eq(s.leads.id, lead.id));
      continue;
    }

    stats.qualified++;
    await db.update(s.leads).set({
      contactStatus: 'contacted', qualificationStatus: 'qualified',
      interestLevel: interest, status: 'qualified', qualifiedAt: call1At,
      liveConfirmation: chance(0.7) ? 'confirmed' : 'likely',
      // webinar_attended se queda NULL a propósito: el acceso al directo es un
      // enlace genérico de Zoom y no sabemos quién entró.
    }).where(eq(s.leads.id, lead.id));

    if (!chance(0.55)) continue;

    stats.meetings++;
    const inFuture = chance(0.35);
    const scheduledAt = inFuture ? hoursFromNow(2 + rnd() * 70) : daysAgo(rnd() * 3);
    const needsConfirm = inFuture && chance(0.5);

    const [meeting] = await db.insert(s.meetings).values({
      leadId: lead.id, closerId: iwelo.id, launchId: launch.id, meetingNumber: 1,
      externalProvider: 'calendly', externalBookingId: `evt_${randomUUID().slice(0, 12)}`,
      scheduledAt, status: 'scheduled', commercialResult: 'pending',
      confirmation24hStatus: needsConfirm ? 'pending' : 'confirmed',
    }).returning();

    await db.update(s.leads).set({
      status: 'meeting_scheduled', assignedCloserId: iwelo.id,
      nextActionType: 'meeting', nextActionAt: scheduledAt,
    }).where(eq(s.leads.id, lead.id));

    await db.insert(s.leadActivity).values({
      leadId: lead.id, eventType: 'MEETING_BOOKED', title: 'Reunión #1 agendada',
      occurredAt: new Date(scheduledAt.getTime() - 86400_000),
    });

    if (needsConfirm) {
      await db.insert(s.tasks).values({
        launchId: launch.id, title: `Confirmar reunión 24 h · ${name}`,
        reason: 'La reunión empieza en menos de 24 h y no hay confirmación registrada.',
        taskType: 'confirm_meeting_24h', source: 'automation',
        automationRuleCode: 'CONFIRM_MEETING_24H',
        dedupeKey: `confirm_meeting_24h:${meeting.id}`,
        assigneeId: setterId, dueAt: new Date(scheduledAt.getTime() - 20 * 3600_000),
        priority: 'critical', relatedLeadId: lead.id, relatedMeetingId: meeting.id,
      });
      await db.insert(s.setterCalls).values({
        leadId: lead.id, setterId, launchId: launch.id, meetingId: meeting.id,
        callType: 'meeting_24h', callGroupId: randomUUID(), attemptNumber: 1,
        scheduledAt: new Date(scheduledAt.getTime() - 20 * 3600_000), status: 'scheduled',
      });
    }

    if (inFuture) continue;

    const roll = rnd();

    if (roll < 0.14) {
      // No-show. NO marca el lead como perdido: se puede reagendar.
      await db.update(s.meetings).set({ status: 'no_show', noShowMarkedAt: scheduledAt })
        .where(eq(s.meetings.id, meeting.id));
      await db.insert(s.leadActivity).values({
        leadId: lead.id, eventType: 'MEETING_NO_SHOW', title: 'Reunión #1: no-show', occurredAt: scheduledAt,
      });
      await db.insert(s.tasks).values({
        launchId: launch.id, title: `Recuperar no-show · ${name}`,
        reason: 'El lead no apareció. Contactar para reagendar antes de darlo por perdido.',
        taskType: 'follow_up', source: 'automation', automationRuleCode: 'NO_SHOW_RECOVERY',
        dedupeKey: `noshow_recovery:${meeting.id}`,
        assigneeId: setterId, dueAt: hoursFromNow(rnd() * 6), priority: 'high',
        relatedLeadId: lead.id, relatedMeetingId: meeting.id,
      });
      continue;
    }

    if (roll < 0.34) {
      stats.sales++;
      const financed = chance(0.45);
      const installments = financed ? pick([3, 6]) : null;
      const amount = 300_000;

      await db.update(s.meetings).set({
        status: 'completed', commercialResult: 'won', endedAt: scheduledAt,
        notes: 'Cierra en la primera. Objeción de tiempo resuelta con el sistema de producción.',
        phantomUrl: 'https://phantom.example.com/rec/' + randomUUID().slice(0, 8),
      }).where(eq(s.meetings.id, meeting.id));

      const [sale] = await db.insert(s.sales).values({
        leadId: lead.id, meetingId: meeting.id, closerId: iwelo.id, launchId: launch.id,
        amountCents: amount, paymentMethod: financed ? 'financing' : 'card',
        financingStatus: financed ? 'approved' : 'not_applicable',
        financingProvider: financed ? 'Sequra' : null,
        installments, installmentCents: installments ? Math.round(amount / installments) : null,
        closedAt: scheduledAt, idempotencyKey: `seed_${meeting.id}`,
      }).returning();

      if (installments) {
        const per = Math.round(amount / installments);
        for (let k = 1; k <= installments; k++) {
          const due = new Date(scheduledAt); due.setMonth(due.getMonth() + (k - 1));
          await db.insert(s.payments).values({
            saleId: sale.id,
            // El redondeo se acumula en la última cuota: las cuotas tienen que
            // sumar exactamente el importe, no aproximadamente.
            amountCents: k === installments ? amount - per * (installments - 1) : per,
            status: k === 1 ? 'paid' : 'pending',
            dueAt: due, paidAt: k === 1 ? scheduledAt : null, installmentNumber: k,
          });
        }
      }

      await db.update(s.leads).set({
        status: 'won', wonAt: scheduledAt, revenueCents: amount,
        nextActionType: null, nextActionAt: null,
      }).where(eq(s.leads.id, lead.id));

      await db.insert(s.leadActivity).values({
        leadId: lead.id, eventType: 'SALE_CREATED',
        title: 'Venta cerrada · reunión #1', description: '3.000 €', occurredAt: scheduledAt,
      });
      continue;
    }

    if (roll < 0.62) {
      // Seguimiento: SIEMPRE con fecha y próxima acción. Un seguimiento sin
      // fecha es un lead olvidado con otro nombre.
      const followUpAt = hoursFromNow(12 + rnd() * 96);
      await db.update(s.meetings).set({
        status: 'completed', commercialResult: 'follow_up', endedAt: scheduledAt,
        followUpReason: pick(['Necesita revisar financiación con su pareja', 'Quiere pensarlo hasta el lunes', 'Espera cobrar a final de mes']),
        followUpAt, nextAction: 'Llamada de seguimiento',
        notes: 'Buen fit. La objeción real es timing, no precio.',
      }).where(eq(s.meetings.id, meeting.id));

      await db.update(s.leads).set({
        status: 'follow_up', nextActionType: 'Llamada de seguimiento', nextActionAt: followUpAt,
      }).where(eq(s.leads.id, lead.id));

      await db.insert(s.tasks).values({
        launchId: launch.id, title: `Seguimiento · ${name}`,
        reason: 'Seguimiento acordado en la reunión.',
        taskType: 'follow_up', source: 'automation', automationRuleCode: 'FOLLOW_UP_FROM_MEETING',
        dedupeKey: `follow_up:${meeting.id}`,
        assigneeId: iwelo.id, dueAt: followUpAt, priority: 'high',
        relatedLeadId: lead.id, relatedMeetingId: meeting.id,
      });

      await db.insert(s.leadActivity).values({
        leadId: lead.id, eventType: 'FOLLOW_UP_CREATED', title: 'Reunión #1: seguimiento', occurredAt: scheduledAt,
      });
      continue;
    }

    if (roll < 0.85) {
      // Perdido, siempre con motivo del catálogo: el texto libre no se agrega.
      const reason = pick(
        (lossReasons as Array<{ id: string; code: string; label: string }>)
          .filter((r) => r.code !== 'other'),
      );
      await db.update(s.meetings).set({
        status: 'completed', commercialResult: 'lost', endedAt: scheduledAt,
        lossReasonId: reason.id, notes: 'No avanza. Motivo declarado: ' + reason.label,
      }).where(eq(s.meetings.id, meeting.id));
      await db.update(s.leads).set({ status: 'lost', lostAt: scheduledAt })
        .where(eq(s.leads.id, lead.id));
      await db.insert(s.leadActivity).values({
        leadId: lead.id, eventType: 'MEETING_LOST',
        title: 'Reunión #1: perdida', description: `Motivo: ${reason.label}`, occurredAt: scheduledAt,
      });
      continue;
    }

    // Sin registrar: alimenta la alerta "reuniones sin resultado".
    await db.insert(s.tasks).values({
      launchId: launch.id, title: `Registrar resultado · ${name}`,
      reason: 'La reunión ya pasó y no tiene resultado comercial registrado.',
      taskType: 'meeting_result', source: 'automation', automationRuleCode: 'MEETING_RESULT_MISSING',
      dedupeKey: `meeting_result:${meeting.id}`,
      assigneeId: iwelo.id, dueAt: scheduledAt, priority: 'critical',
      relatedLeadId: lead.id, relatedMeetingId: meeting.id,
    });
  }

  /* ── Cola de Call #1 pendiente para hoy ────────────────────────────── */
  const pendientes = await db.select().from(s.leads)
    .where(sql`contact_status = 'not_attempted' and eligible_for_setter = true`).limit(8);

  for (const lead of pendientes) {
    const [c] = await db.insert(s.setterCalls).values({
      leadId: lead.id, setterId: lead.assignedSetterId, launchId: launch.id,
      callType: 'post_class_1', callGroupId: randomUUID(), attemptNumber: 1,
      scheduledAt: hoursFromNow(-1 + rnd() * 5), status: 'scheduled',
    }).returning();

    await db.insert(s.tasks).values({
      launchId: launch.id, title: `Llamada #1 · Cualificación · ${lead.fullName}`,
      reason: 'Primera cualificación tras la Clase 1.',
      taskType: 'call_1', source: 'automation', automationRuleCode: 'SCHEDULE_POST_CLASS_1',
      dedupeKey: `call_1:${lead.id}`,
      assigneeId: lead.assignedSetterId, dueAt: c.scheduledAt, priority: 'high',
      relatedLeadId: lead.id, relatedSetterCallId: c.id,
    });
  }

  /* ── Evergreen: DM de Instagram → compra en Hotmart ─────────────────
   * Otro embudo, otro ritmo. Aqui no hay clases ni reuniones: la gente
   * escribe, el setter responde y compra directamente. Mezclar estas ventas
   * con las del lanzamiento hundiria el close rate de las reuniones. */
  const IG = ['martacreando','dani.vlogs','lauraruiz.es','elenamkt','carlos_faceless',
              'nuriaonline','pablo.edits','sofia.crea','javi_ai','anacontenido',
              'raul.shorts','irenedigital','toni.canales','vega.media','hugo.remoto',
              'clara.nichos','marc.automatiza','noe.creativa'];

  let evergreenSales = 0;
  for (let i = 0; i < IG.length; i++) {
    const handle = IG[i];
    const nombre = handle.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const at = daysAgo(rnd() * 25);
    seq++;

    const [lead] = await db.insert(s.leads).values({
      launchId: evergreen.id,
      publicId: `LD-${String(seq).padStart(6, '0')}`,
      fullName: nombre,
      channel: 'instagram_dm',
      instagramUsername: handle,
      externalContactId: `mc_seed_${i}`,
      conversationUrl: `https://www.instagram.com/${handle}/`,
      assignedSetterId: angel.id,
      eligibleForSetter: true,
      contactStatus: 'contacted',
      status: 'contacted',
      registeredAt: at,
      emailRaw: `${handle}@example.com`,
      emailNormalized: `${handle}@example.com`,
    }).returning();

    await db.insert(s.leadAttribution).values({
      leadId: lead.id, touch: 'first', source: 'organic',
      utmSource: 'instagram', capturedAt: at,
    });
    await db.insert(s.leadActivity).values({
      leadId: lead.id, eventType: 'LEAD_CREATED',
      title: 'Conversación iniciada en Instagram',
      description: `@${handle}`, occurredAt: at,
    });

    // Un tercio compra directamente; el resto sigue en conversación.
    if (chance(0.33)) {
      evergreenSales++;
      const amount = 149_700;
      const [sale] = await db.insert(s.sales).values({
        leadId: lead.id, meetingId: null, closerId: null, launchId: evergreen.id,
        source: 'hotmart', externalId: `HM-SEED-${i}`,
        amountCents: amount, paymentMethod: 'hotmart',
        closedAt: new Date(at.getTime() + 2 * 86400_000),
        idempotencyKey: `hotmart:HM-SEED-${i}`,
        notes: 'Faceless Academy',
      }).returning();

      await db.insert(s.payments).values({
        saleId: sale.id, amountCents: amount, status: 'paid',
        paidAt: new Date(at.getTime() + 2 * 86400_000), installmentNumber: 1,
        externalRef: `HM-SEED-${i}`,
      });

      await db.update(s.leads).set({
        status: 'won', wonAt: new Date(at.getTime() + 2 * 86400_000),
        revenueCents: amount, qualificationStatus: 'qualified', interestLevel: 'high',
      }).where(eq(s.leads.id, lead.id));

      await db.insert(s.leadActivity).values({
        leadId: lead.id, eventType: 'SALE_CREATED',
        title: 'Compra en Hotmart', description: '1.497 € · Faceless Academy',
        occurredAt: new Date(at.getTime() + 2 * 86400_000),
      });
    } else if (chance(0.5)) {
      await db.insert(s.tasks).values({
        launchId: evergreen.id, title: `Atender conversación · ${nombre}`,
        reason: 'Conversación abierta en Instagram sin responder.',
        taskType: 'manual', source: 'automation', automationRuleCode: 'INSTAGRAM_CONVERSATION',
        dedupeKey: `ig_conversation:mc_seed_${i}`,
        assigneeId: angel.id, dueAt: hoursFromNow(-1 + rnd() * 6),
        priority: 'high', relatedLeadId: lead.id,
      });
    }
  }

  // La secuencia tiene que quedar POR DELANTE del ultimo public_id sembrado:
  // si no, el primer lead que entre por webhook choca contra LD-000001.
  await db.execute(sql.raw(
    "select setval('lead_public_seq', (select coalesce(max(substring(public_id from 4)::int), 1) from leads))",
  ));

  log(`  LANZAMIENTO · ${NOMBRES.length} leads · ${stats.qualified} cualificados · ${stats.meetings} reuniones · ${stats.sales} ventas`);
  log(`  EVERGREEN   · ${IG.length} leads de Instagram · ${evergreenSales} compras en Hotmart`);
  return stats;
}
