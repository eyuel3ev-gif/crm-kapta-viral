import { and, eq, gte, lte, lt, isNull, sql, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  leads, meetings, setterCalls, tasks, launches, launchEvents, automationSettings,
} from '@/db/schema';
import { scheduleCall } from './setter-calls';
import { upsertSmartTask } from './tasks';

/**
 * Motor de reglas.
 *
 * Todas viven aquí, con un `code` estable. La alternativa —ifs sueltos por
 * veinte ficheros— es exactamente lo que hace que en la semana 3 nadie sepa
 * por qué se ha creado una tarea.
 *
 * Todas son IDEMPOTENTES: se pueden ejecutar cada 5 minutos durante un mes
 * sin generar un solo duplicado, porque cada tarea lleva su `dedupe_key`.
 */

export type RuleResult = { code: string; created: number; skipped: number };

async function setting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.select().from(automationSettings)
    .where(eq(automationSettings.key, key)).limit(1);
  return { ...fallback, ...(row[0]?.valueJson as object ?? {}) } as T;
}

/* ── REGLA 1 · Crear la llamada de cualificación ─────────────────────── */

/**
 * Se dispara X horas después de la Clase 1, no "cuando el lead ve la clase":
 * con enlace genérico no sabemos quién la vio, y esperar ese dato bloquearía
 * toda la operativa del setter.
 */
export async function ruleCreateCall1(): Promise<RuleResult> {
  const cfg = await setting('call_1_window', { hours_after_class_1: 6, start_hour: 15, end_hour: 21 });
  let created = 0, skipped = 0;

  // Solo lanzamiento: en Evergreen no hay Clase 1 de la que colgar la cola.
  const launch = await db.select().from(launches)
    .where(and(eq(launches.status, 'active'), eq(launches.type, 'launch'))).limit(1);
  if (!launch.length) return { code: 'CREATE_CALL_1', created, skipped };

  const class1 = await db.select().from(launchEvents)
    .where(and(eq(launchEvents.launchId, launch[0].id), eq(launchEvents.code, 'CLASS_1'))).limit(1);
  if (!class1.length) return { code: 'CREATE_CALL_1', created, skipped };

  const opensAt = new Date(class1[0].startsAt.getTime() + cfg.hours_after_class_1 * 3600_000);
  if (Date.now() < opensAt.getTime()) return { code: 'CREATE_CALL_1', created, skipped };

  const candidates = await db.select().from(leads)
    .where(and(
      eq(leads.launchId, launch[0].id),
      eq(leads.eligibleForSetter, true),
      eq(leads.contactStatus, 'not_attempted'),
      isNotNull(leads.assignedSetterId),
      isNull(leads.archivedAt),
    ))
    .limit(200);

  for (const lead of candidates) {
    const existing = await db.select({ id: setterCalls.id }).from(setterCalls)
      .where(and(eq(setterCalls.leadId, lead.id), eq(setterCalls.callType, 'post_class_1')))
      .limit(1);
    if (existing.length) { skipped++; continue; }

    await db.transaction(async (tx) => {
      await scheduleCall(tx, {
        leadId: lead.id,
        setterId: lead.assignedSetterId!,
        launchId: lead.launchId,
        callType: 'post_class_1',
        scheduledAt: withinWindow(new Date(), cfg.start_hour, cfg.end_hour),
        dedupeKey: `call_1:${lead.id}`,
        reason: 'Primera cualificación tras la Clase 1.',
        leadName: lead.fullName,
        priority: 'high',
      });
    });
    created++;
  }

  return { code: 'CREATE_CALL_1', created, skipped };
}

/* ── REGLA 2 · Confirmar el directo ──────────────────────────────────── */

export async function ruleConfirmLive(): Promise<RuleResult> {
  const cfg = await setting('live_confirmation_segment', { qualified_only: true, min_interest: 'medium' });
  let created = 0, skipped = 0;

  // Solo lanzamiento: sin directo no hay nada que confirmar.
  const launch = await db.select().from(launches)
    .where(and(eq(launches.status, 'active'), eq(launches.type, 'launch'))).limit(1);
  if (!launch.length) return { code: 'CONFIRM_LIVE', created, skipped };

  const webinar = await db.select().from(launchEvents)
    .where(and(eq(launchEvents.launchId, launch[0].id), eq(launchEvents.eventType, 'webinar')))
    .orderBy(launchEvents.startsAt).limit(1);
  if (!webinar.length) return { code: 'CONFIRM_LIVE', created, skipped };

  const hoursUntil = (webinar[0].startsAt.getTime() - Date.now()) / 3600_000;
  // Ventana: entre 30 h y 4 h antes del directo.
  if (hoursUntil > 30 || hoursUntil < 4) return { code: 'CONFIRM_LIVE', created, skipped };

  const interestTiers = cfg.min_interest === 'high'
    ? ['high', 'very_high'] : ['medium', 'high', 'very_high'];

  const candidates = await db.select().from(leads)
    .where(and(
      eq(leads.launchId, launch[0].id),
      eq(leads.qualificationStatus, 'qualified'),
      inArray(leads.interestLevel, interestTiers),
      isNull(leads.liveConfirmation),
      isNotNull(leads.assignedSetterId),
    ))
    .limit(200);

  for (const lead of candidates) {
    const existing = await db.select({ id: setterCalls.id }).from(setterCalls)
      .where(and(eq(setterCalls.leadId, lead.id), eq(setterCalls.callType, 'webinar_confirmation')))
      .limit(1);
    if (existing.length) { skipped++; continue; }

    await db.transaction(async (tx) => {
      await scheduleCall(tx, {
        leadId: lead.id, setterId: lead.assignedSetterId!, launchId: lead.launchId,
        callType: 'webinar_confirmation',
        scheduledAt: new Date(Date.now() + 3600_000),
        dedupeKey: `confirm_live:${lead.id}`,
        reason: `Lead cualificado con interés ${lead.interestLevel}. El directo es en ${Math.round(hoursUntil)} h.`,
        leadName: lead.fullName,
        priority: 'medium',
      });
    });
    created++;
  }

  return { code: 'CONFIRM_LIVE', created, skipped };
}

/* ── REGLA 3 · Confirmación 24 h ─────────────────────────────────────── */

/**
 * La regla con más impacto directo en el show rate.
 * Idempotente por `confirm_meeting_24h:{meeting_id}`: el cron puede correr
 * cada 5 minutos y solo existe una tarea por reunión.
 */
export async function ruleConfirm24h(): Promise<RuleResult> {
  const cfg = await setting('confirmation_24h_window', { lookahead_hours: 24, lookbehind_hours: 25 });
  let created = 0, skipped = 0;

  const from = new Date(Date.now() + (cfg.lookahead_hours - 1) * 3600_000);
  const to = new Date(Date.now() + cfg.lookbehind_hours * 3600_000);

  const upcoming = await db.select({
    m: meetings, leadName: leads.fullName, setterId: leads.assignedSetterId,
  })
    .from(meetings)
    .innerJoin(leads, eq(leads.id, meetings.leadId))
    .where(and(
      eq(meetings.status, 'scheduled'),
      gte(meetings.scheduledAt, from),
      lte(meetings.scheduledAt, to),
      eq(meetings.confirmation24hStatus, 'pending'),
    ))
    .limit(200);

  for (const row of upcoming) {
    const assignee = row.setterId ?? row.m.closerId;
    if (!assignee) { skipped++; continue; }

    const existing = await db.select({ id: setterCalls.id }).from(setterCalls)
      .where(and(
        eq(setterCalls.meetingId, row.m.id),
        eq(setterCalls.callType, 'meeting_24h'),
      )).limit(1);
    if (existing.length) { skipped++; continue; }

    await db.transaction(async (tx) => {
      await scheduleCall(tx, {
        leadId: row.m.leadId, setterId: assignee, launchId: row.m.launchId,
        callType: 'meeting_24h', meetingId: row.m.id,
        scheduledAt: new Date(Date.now() + 1800_000),
        dedupeKey: `confirm_meeting_24h:${row.m.id}`,
        reason: 'La reunión empieza en menos de 24 h y no hay confirmación registrada.',
        leadName: row.leadName,
        priority: 'critical',
      });
    });
    created++;
  }

  return { code: 'CONFIRM_MEETING_24H', created, skipped };
}

/* ── REGLA 4 · Reunión sin resultado ─────────────────────────────────── */

/**
 * Una reunión que pasó y nadie registró es un agujero en TODAS las métricas:
 * el show rate, el close rate y el revenue quedan mal a la vez.
 */
export async function ruleMeetingResultMissing(): Promise<RuleResult> {
  let created = 0, skipped = 0;

  const stale = await db.select({ m: meetings, leadName: leads.fullName })
    .from(meetings).innerJoin(leads, eq(leads.id, meetings.leadId))
    .where(and(
      eq(meetings.status, 'scheduled'),
      lt(meetings.scheduledAt, new Date(Date.now() - 2 * 3600_000)),
    ))
    .limit(100);

  for (const row of stale) {
    if (!row.m.closerId) { skipped++; continue; }
    const id = await upsertSmartTask(db, {
      dedupeKey: `meeting_result:${row.m.id}`,
      title: `Registrar resultado · ${row.leadName}`,
      reason: 'La reunión ya pasó y no tiene resultado comercial registrado.',
      taskType: 'meeting_result',
      assigneeId: row.m.closerId,
      dueAt: new Date(),
      priority: 'critical',
      launchId: row.m.launchId,
      relatedLeadId: row.m.leadId,
      relatedMeetingId: row.m.id,
      ruleCode: 'MEETING_RESULT_MISSING',
    });
    id ? created++ : skipped++;
  }

  return { code: 'MEETING_RESULT_MISSING', created, skipped };
}

/* ── REGLA 5 · Cualificado sin próxima acción ────────────────────────── */

export async function ruleQualifiedWithoutAction(): Promise<RuleResult> {
  let created = 0, skipped = 0;

  const orphans = await db.select().from(leads)
    .where(and(
      eq(leads.qualificationStatus, 'qualified'),
      inArray(leads.status, ['qualified', 'contacted']),
      isNull(leads.nextActionAt),
      isNotNull(leads.assignedSetterId),
    ))
    .limit(100);

  for (const lead of orphans) {
    const open = await db.select({ id: tasks.id }).from(tasks)
      .where(and(
        eq(tasks.relatedLeadId, lead.id),
        inArray(tasks.status, ['pending', 'in_progress']),
      )).limit(1);
    if (open.length) { skipped++; continue; }

    const id = await upsertSmartTask(db, {
      dedupeKey: `define_next_action:${lead.id}`,
      title: `Definir próxima acción · ${lead.fullName}`,
      reason: 'Lead cualificado sin ninguna acción pendiente. Se está enfriando.',
      taskType: 'manual',
      assigneeId: lead.assignedSetterId,
      dueAt: new Date(Date.now() + 4 * 3600_000),
      priority: 'high',
      launchId: lead.launchId,
      relatedLeadId: lead.id,
      ruleCode: 'QUALIFIED_WITHOUT_ACTION',
    });
    id ? created++ : skipped++;
  }

  return { code: 'QUALIFIED_WITHOUT_ACTION', created, skipped };
}

/* ── Runner ──────────────────────────────────────────────────────────── */

export async function runAllRules(): Promise<RuleResult[]> {
  const results: RuleResult[] = [];
  // Se ejecutan en secuencia y cada una aislada: que falle una no puede
  // impedir que corran las demás.
  for (const rule of [
    ruleCreateCall1, ruleConfirmLive, ruleConfirm24h,
    ruleMeetingResultMissing, ruleQualifiedWithoutAction,
  ]) {
    try {
      results.push(await rule());
    } catch (err) {
      results.push({ code: `${rule.name}:ERROR`, created: 0, skipped: 0 });
      console.error(`[automation] ${rule.name}`, err);
    }
  }
  return results;
}

/** Empuja una hora dentro de la ventana de llamadas configurada. */
function withinWindow(d: Date, startHour: number, endHour: number): Date {
  const out = new Date(d);
  if (out.getHours() < startHour) out.setHours(startHour, 0, 0, 0);
  if (out.getHours() >= endHour) {
    out.setDate(out.getDate() + 1);
    out.setHours(startHour, 0, 0, 0);
  }
  return out;
}
