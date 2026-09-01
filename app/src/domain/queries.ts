import { and, eq, or, sql, desc, asc, gte, lte, ilike, inArray, isNull, isNotNull, count } from 'drizzle-orm';
import { db } from '@/db';
import {
  leads, leadAttribution, meetings, setterCalls, setterCallAnswers, setterCallQuestions,
  tasks, users, sales, leadActivity, formSubmissions, formAnswers, formQuestions,
  formVersions, forms, lossReasons, payments,
} from '@/db/schema';
import type { LeadScope } from '@/lib/permissions';

/** El alcance se traduce a un WHERE, no a un filtro en memoria: filtrar
 *  después de traer las filas significa que ya salieron de la base de datos. */
function scopeCondition(scope: LeadScope) {
  if (scope.kind === 'all') return undefined;
  if (scope.kind === 'setter') return eq(leads.assignedSetterId, scope.userId);
  return or(
    eq(leads.assignedCloserId, scope.userId),
    sql`exists (select 1 from meetings m where m.lead_id = ${leads.id} and m.closer_id = ${scope.userId})`,
  );
}

/* ── Listado de leads ────────────────────────────────────────────────── */

export type LeadFilters = {
  search?: string;
  status?: string;
  quickFilter?: string;
  page?: number;
  perPage?: number;
  /** Lanzamientos que entran. null o ausente = todos. */
  launchIds?: string[] | null;
};

/** Vacío = no existe ningún lanzamiento de ese tipo: se fuerza vacío. */
function launchCond(launchIds?: string[] | null) {
  if (!launchIds) return undefined;
  if (launchIds.length === 0) return sql`false`;
  return inArray(leads.launchId, launchIds);
}

export async function listLeads(scope: LeadScope, f: LeadFilters = {}) {
  const page = Math.max(1, f.page ?? 1);
  const perPage = Math.min(100, f.perPage ?? 50);

  const conds = [scopeCondition(scope), isNull(leads.mergedIntoLeadId), launchCond(f.launchIds)].filter(Boolean);

  if (f.search) {
    const q = `%${f.search.trim()}%`;
    conds.push(or(
      ilike(leads.fullName, q),
      ilike(leads.publicId, q),
      ilike(leads.phoneNormalized, q),
      ilike(leads.phoneRaw, q),
      ilike(leads.emailNormalized, q),
    ));
  }
  if (f.status) conds.push(eq(leads.status, f.status));

  switch (f.quickFilter) {
    case 'nuevos': conds.push(eq(leads.status, 'new')); break;
    case 'cualificados': conds.push(eq(leads.qualificationStatus, 'qualified')); break;
    case 'no-cualificados': conds.push(eq(leads.qualificationStatus, 'disqualified')); break;
    case 'con-reunion': conds.push(inArray(leads.status, ['meeting_scheduled', 'meeting_held'])); break;
    case 'seguimiento': conds.push(eq(leads.status, 'follow_up')); break;
    case 'ganados': conds.push(eq(leads.status, 'won')); break;
    case 'perdidos': conds.push(eq(leads.status, 'lost')); break;
    case 'sin-accion':
      conds.push(and(eq(leads.qualificationStatus, 'qualified'), isNull(leads.nextActionAt))!);
      break;
    case 'no-contactables': conds.push(eq(leads.contactStatus, 'unreachable')); break;
  }

  const where = conds.length ? and(...conds) : undefined;

  const rows = await db.select({
    lead: leads,
    setterName: users.name,
    source: leadAttribution.source,
    campaign: leadAttribution.campaignName,
  })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedSetterId))
    .leftJoin(leadAttribution, and(eq(leadAttribution.leadId, leads.id), eq(leadAttribution.touch, 'first')))
    .where(where)
    .orderBy(desc(leads.registeredAt))
    .limit(perPage).offset((page - 1) * perPage);

  const [{ total }] = await db.select({ total: count() }).from(leads).where(where);

  return { rows, total: Number(total), page, perPage, totalPages: Math.ceil(Number(total) / perPage) };
}

/* ── Ficha del lead ──────────────────────────────────────────────────── */

export async function getLeadProfile(leadId: string) {
  const rows = await db.select({
    lead: leads,
    setterName: users.name,
  })
    .from(leads).leftJoin(users, eq(users.id, leads.assignedSetterId))
    .where(eq(leads.id, leadId)).limit(1);
  if (!rows.length) return null;

  const [attribution, calls, mtgs, activity, pending, submissions] = await Promise.all([
    db.select().from(leadAttribution).where(eq(leadAttribution.leadId, leadId)),
    db.select({ call: setterCalls, setterName: users.name })
      .from(setterCalls).leftJoin(users, eq(users.id, setterCalls.setterId))
      .where(eq(setterCalls.leadId, leadId)).orderBy(asc(setterCalls.createdAt)),
    db.select({ meeting: meetings, closerName: users.name, lossLabel: lossReasons.label })
      .from(meetings)
      .leftJoin(users, eq(users.id, meetings.closerId))
      .leftJoin(lossReasons, eq(lossReasons.id, meetings.lossReasonId))
      .where(eq(meetings.leadId, leadId)).orderBy(asc(meetings.meetingNumber)),
    db.select({ a: leadActivity, actorName: users.name })
      .from(leadActivity).leftJoin(users, eq(users.id, leadActivity.actorUserId))
      .where(eq(leadActivity.leadId, leadId)).orderBy(desc(leadActivity.occurredAt)).limit(100),
    db.select({ task: tasks, assigneeName: users.name })
      .from(tasks).leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(eq(tasks.relatedLeadId, leadId), inArray(tasks.status, ['pending', 'in_progress'])))
      .orderBy(asc(tasks.dueAt)),
    db.select({
      submissionId: formSubmissions.id,
      formCode: forms.code,
      formName: forms.name,
      submittedAt: formSubmissions.submittedAt,
    })
      .from(formSubmissions)
      .innerJoin(formVersions, eq(formVersions.id, formSubmissions.formVersionId))
      .innerJoin(forms, eq(forms.id, formVersions.formId))
      .where(eq(formSubmissions.leadId, leadId))
      .orderBy(asc(formSubmissions.submittedAt)),
  ]);

  const answers = submissions.length
    ? await db.select({
        submissionId: formAnswers.submissionId,
        question: formAnswers.questionTextSnapshot,
        answer: formAnswers.answerText,
      }).from(formAnswers)
        .where(inArray(formAnswers.submissionId, submissions.map((s) => s.submissionId)))
    : [];

  const callAnswers = calls.length
    ? await db.select({
        callId: setterCallAnswers.setterCallId,
        question: setterCallAnswers.questionTextSnapshot,
        answer: setterCallAnswers.answerText,
      }).from(setterCallAnswers)
        .where(inArray(setterCallAnswers.setterCallId, calls.map((c) => c.call.id)))
    : [];

  return {
    lead: rows[0].lead,
    setterName: rows[0].setterName,
    attribution: attribution.find((a) => a.touch === 'first') ?? null,
    calls, callAnswers, meetings: mtgs, activity, pending, submissions, answers,
  };
}

/* ── Mi trabajo (setter) ─────────────────────────────────────────────── */

/**
 * La cola operativa. El orden lo decide el sistema, no el setter:
 *   1. vencidas críticas   2. confirmaciones 24 h   3. resto por fecha
 * Un setter que tiene que decidir a quién llamar primero pierde media hora
 * al día y se equivoca.
 */
export async function getWorkToday(userId: string) {
  const rows = await db.select({
    task: tasks,
    lead: leads,
    call: setterCalls,
    meeting: meetings,
  })
    .from(tasks)
    .leftJoin(leads, eq(leads.id, tasks.relatedLeadId))
    .leftJoin(setterCalls, eq(setterCalls.id, tasks.relatedSetterCallId))
    .leftJoin(meetings, eq(meetings.id, tasks.relatedMeetingId))
    .where(and(
      eq(tasks.assigneeId, userId),
      inArray(tasks.status, ['pending', 'in_progress']),
    ))
    .orderBy(asc(tasks.dueAt))
    .limit(200);

  const rank = (t: typeof rows[number]) => {
    const overdue = t.task.dueAt ? t.task.dueAt.getTime() < Date.now() : false;
    if (overdue && t.task.priority === 'critical') return 0;
    if (t.task.taskType === 'confirm_meeting_24h') return 1;
    if (overdue) return 2;
    if (t.task.taskType === 'call_1_retry') return 3;
    if (t.task.taskType === 'call_1') return 4;
    if (t.task.taskType === 'confirm_live') return 5;
    return 6;
  };

  return rows.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return (a.task.dueAt?.getTime() ?? Infinity) - (b.task.dueAt?.getTime() ?? Infinity);
  });
}

export async function getSetterSummary(userId: string) {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);

  const [today] = await db.select({
    total: sql<number>`count(*)::int`,
    completed: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`,
    pending: sql<number>`count(*) filter (where ${tasks.status} = 'pending')::int`,
    overdue: sql<number>`count(*) filter (where ${tasks.status} = 'pending' and ${tasks.dueAt} < now())::int`,
    retries: sql<number>`count(*) filter (where ${tasks.taskType} = 'call_1_retry' and ${tasks.status} = 'pending')::int`,
    confirmations: sql<number>`count(*) filter (where ${tasks.taskType} = 'confirm_meeting_24h' and ${tasks.status} = 'pending')::int`,
  })
    .from(tasks)
    .where(and(
      eq(tasks.assigneeId, userId),
      or(lte(tasks.dueAt, endOfDay), isNull(tasks.dueAt)),
    ));

  return today;
}

/* ── Reuniones (closer) ──────────────────────────────────────────────── */

export async function getCloserMeetings(userId: string) {
  const rows = await db.select({ meeting: meetings, lead: leads, setterName: users.name })
    .from(meetings)
    .innerJoin(leads, eq(leads.id, meetings.leadId))
    .leftJoin(users, eq(users.id, leads.assignedSetterId))
    .where(eq(meetings.closerId, userId))
    .orderBy(asc(meetings.scheduledAt))
    .limit(300);

  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);

  return {
    today: rows.filter((r) => r.meeting.scheduledAt >= startOfDay && r.meeting.scheduledAt <= endOfDay
      && r.meeting.status === 'scheduled'),
    upcoming: rows.filter((r) => r.meeting.scheduledAt > endOfDay && r.meeting.status === 'scheduled'),
    // Ya pasaron y siguen sin resultado: es el bloque más urgente.
    pendingResult: rows.filter((r) => r.meeting.status === 'scheduled' && r.meeting.scheduledAt < startOfDay),
    followUps: rows.filter((r) => r.meeting.commercialResult === 'follow_up'),
    noShows: rows.filter((r) => r.meeting.status === 'no_show'),
  };
}

export async function getMeetingDetail(meetingId: string) {
  const rows = await db.select({
    meeting: meetings, lead: leads, closerName: users.name,
  })
    .from(meetings)
    .innerJoin(leads, eq(leads.id, meetings.leadId))
    .leftJoin(users, eq(users.id, meetings.closerId))
    .where(eq(meetings.id, meetingId)).limit(1);
  if (!rows.length) return null;

  const leadId = rows[0].lead.id;

  const [priorMeetings, calls, callAnswers, profileAnswers, reasons] = await Promise.all([
    db.select({ meeting: meetings, lossLabel: lossReasons.label })
      .from(meetings).leftJoin(lossReasons, eq(lossReasons.id, meetings.lossReasonId))
      .where(and(eq(meetings.leadId, leadId), sql`${meetings.meetingNumber} < ${rows[0].meeting.meetingNumber}`))
      .orderBy(asc(meetings.meetingNumber)),
    db.select({ call: setterCalls, setterName: users.name })
      .from(setterCalls).leftJoin(users, eq(users.id, setterCalls.setterId))
      .where(and(eq(setterCalls.leadId, leadId), eq(setterCalls.answered, true)))
      .orderBy(asc(setterCalls.createdAt)),
    db.select({
      callId: setterCallAnswers.setterCallId,
      question: setterCallAnswers.questionTextSnapshot,
      answer: setterCallAnswers.answerText,
    }).from(setterCallAnswers)
      .innerJoin(setterCalls, eq(setterCalls.id, setterCallAnswers.setterCallId))
      .where(eq(setterCalls.leadId, leadId)),
    db.select({
      question: formAnswers.questionTextSnapshot,
      answer: formAnswers.answerText,
    })
      .from(formAnswers)
      .innerJoin(formSubmissions, eq(formSubmissions.id, formAnswers.submissionId))
      .where(eq(formSubmissions.leadId, leadId)),
    db.select().from(lossReasons).where(eq(lossReasons.active, true)).orderBy(asc(lossReasons.sortOrder)),
  ]);

  return {
    ...rows[0],
    priorMeetings, calls, callAnswers, profileAnswers,
    lossReasons: reasons,
  };
}

/* ── Llamada del setter ──────────────────────────────────────────────── */

export async function getCallDetail(callId: string) {
  const rows = await db.select({ call: setterCalls, lead: leads })
    .from(setterCalls).innerJoin(leads, eq(leads.id, setterCalls.leadId))
    .where(eq(setterCalls.id, callId)).limit(1);
  if (!rows.length) return null;

  const [questions, priorCalls, profileAnswers, meeting] = await Promise.all([
    db.select().from(setterCallQuestions)
      .where(and(eq(setterCallQuestions.callType, rows[0].call.callType), eq(setterCallQuestions.active, true)))
      .orderBy(asc(setterCallQuestions.sortOrder)),
    db.select().from(setterCalls)
      .where(and(
        eq(setterCalls.leadId, rows[0].lead.id),
        sql`${setterCalls.id} <> ${callId}`,
      ))
      .orderBy(asc(setterCalls.createdAt)),
    db.select({ question: formAnswers.questionTextSnapshot, answer: formAnswers.answerText })
      .from(formAnswers)
      .innerJoin(formSubmissions, eq(formSubmissions.id, formAnswers.submissionId))
      .where(eq(formSubmissions.leadId, rows[0].lead.id)),
    rows[0].call.meetingId
      ? db.select().from(meetings).where(eq(meetings.id, rows[0].call.meetingId)).limit(1)
      : Promise.resolve([]),
  ]);

  return { ...rows[0], questions, priorCalls, profileAnswers, meeting: meeting[0] ?? null };
}

/* ── Tareas ──────────────────────────────────────────────────────────── */

export async function listTasks(opts: { assigneeId?: string; status?: string; taskType?: string }) {
  const conds = [];
  if (opts.assigneeId) conds.push(eq(tasks.assigneeId, opts.assigneeId));
  if (opts.taskType) conds.push(eq(tasks.taskType, opts.taskType));
  if (opts.status === 'pending') conds.push(inArray(tasks.status, ['pending', 'in_progress']));
  else if (opts.status === 'overdue') {
    conds.push(and(inArray(tasks.status, ['pending', 'in_progress']), lte(tasks.dueAt, new Date()))!);
  } else if (opts.status) conds.push(eq(tasks.status, opts.status));

  return db.select({ task: tasks, assigneeName: users.name, lead: leads })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(leads, eq(leads.id, tasks.relatedLeadId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(tasks.dueAt))
    .limit(300);
}

export async function listUsers() {
  return db.select().from(users).orderBy(asc(users.name));
}

/* ── Facturación (Owner) ─────────────────────────────────────────────── */

/**
 * Revenue contratado y cash collected NO son lo mismo.
 *
 *   contratado  = lo que se ha vendido
 *   cobrado     = lo que ha entrado en el banco
 *
 * Con financiación a plazos la diferencia es enorme durante meses, y mezclar
 * las dos cifras es la forma más rápida de creerte que tienes un dinero que
 * todavía no está.
 */
export async function getBilling(range: { from: Date; to: Date; launchIds?: string[] | null }) {
  const scope = launchCond(range.launchIds);
  const [totals] = await db.select({
    contractedCents: sql<number>`coalesce(sum(${sales.amountCents}) filter (where ${sales.status} = 'active'), 0)::int`,
    salesCount: sql<number>`count(*) filter (where ${sales.status} = 'active')::int`,
    refundedCents: sql<number>`coalesce(sum(${sales.amountCents}) filter (where ${sales.status} in ('refunded','defaulted')), 0)::int`,
    refundedCount: sql<number>`count(*) filter (where ${sales.status} in ('refunded','defaulted'))::int`,
  })
    .from(sales)
    .innerJoin(leads, eq(leads.id, sales.leadId))
    .where(and(gte(sales.closedAt, range.from), lte(sales.closedAt, range.to), scope));

  const [cash] = await db.select({
    collectedCents: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'paid'), 0)::int`,
    pendingCents: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'pending'), 0)::int`,
    overdueCents: sql<number>`coalesce(sum(${payments.amountCents}) filter (where ${payments.status} = 'pending' and ${payments.dueAt} < now()), 0)::int`,
  })
    .from(payments)
    .innerJoin(sales, eq(sales.id, payments.saleId))
    .innerJoin(leads, eq(leads.id, sales.leadId))
    .where(and(gte(sales.closedAt, range.from), lte(sales.closedAt, range.to), scope));

  const rows = await db.select({
    sale: sales,
    lead: leads,
    closerName: users.name,
  })
    .from(sales)
    .innerJoin(leads, eq(leads.id, sales.leadId))
    .leftJoin(users, eq(users.id, sales.closerId))
    .where(and(gte(sales.closedAt, range.from), lte(sales.closedAt, range.to), scope))
    .orderBy(desc(sales.closedAt))
    .limit(200);

  // Cuotas que aún no han entrado: es el dinero que hay que perseguir.
  const upcoming = await db.select({
    payment: payments,
    lead: leads,
    saleAmount: sales.amountCents,
  })
    .from(payments)
    .innerJoin(sales, eq(sales.id, payments.saleId))
    .innerJoin(leads, eq(leads.id, sales.leadId))
    .where(and(eq(payments.status, 'pending'), eq(sales.status, 'active'), scope))
    .orderBy(asc(payments.dueAt))
    .limit(50);

  return { totals, cash, rows, upcoming };
}
