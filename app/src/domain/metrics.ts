import { and, eq, gte, lte, sql, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { leads, meetings, sales, setterCalls } from '@/db/schema';
import { ratio } from '@/lib/format';

/**
 * REGISTRO CANÓNICO DE MÉTRICAS.
 *
 * Una función por métrica, y TODO el sistema lee de aquí: dashboard,
 * analítica, informes y exportaciones. Si el dashboard calculara el close
 * rate por su cuenta y el informe semanal por la suya, acabarían dando
 * números distintos para la misma semana y nadie sabría cuál creer.
 *
 * Dos reglas heredadas de la especificación:
 *
 *  · Divisor cero devuelve null, nunca Infinity ni 0. En pantalla, "—".
 *    Un "ROAS 0 %" es tan mentira como un "ROAS ∞": lo que pasa es que
 *    todavía no hay datos.
 *
 *  · Cada ratio lleva su denominador explícito en el nombre. "Booking rate"
 *    a secas no significa nada hasta saber sobre qué se divide.
 */

export type Mode = 'activity' | 'cohort';

export type Range = {
  from: Date; to: Date; mode?: Mode;
  /** Lanzamientos que entran. null o ausente = todos. */
  launchIds?: string[] | null;
};

/** Filtro por lanzamiento reutilizable. Vacío = ningún lanzamiento de ese
 *  tipo todavía, así que se fuerza un resultado vacío en vez de todo. */
function launchCond(range: Range) {
  if (!range.launchIds) return undefined;
  if (range.launchIds.length === 0) return sql`false`;
  return inArray(leads.launchId, range.launchIds);
}

export type Funnel = {
  registeredLeads: number;
  contactedLeads: number;
  qualifiedLeads: number;
  leadsWithMeeting: number;
  meetingsBooked: number;
  meetingsHeld: number;
  noShows: number;
  salesWon: number;
  revenueCents: number;
};

export type Kpis = Funnel & {
  qualificationRateRegistered: number | null;
  qualificationRateContacted: number | null;
  contactRate: number | null;
  bookingRateQualified: number | null;
  showRate: number | null;
  closeRateMeetings: number | null;
  closeRateLeads: number | null;
  avgTicketCents: number | null;
  sampleWarning: string | null;
};

/**
 * ACTIVITY  → qué ocurrió en el periodo (una venta de hoy cuenta hoy).
 * COHORT    → qué han hecho los leads captados en el periodo (esa misma venta
 *             cuenta en la semana en la que entró el lead).
 *
 * La distinción no es cosmética: para decidir si un anuncio funciona hay que
 * mirar cohorte. En vista actividad, un anuncio de hace dos semanas parece
 * estar rindiendo hoy.
 */
export async function getFunnel(range: Range): Promise<Funnel> {
  const mode = range.mode ?? 'activity';

  const scope = launchCond(range);
  const leadsInPeriod = and(
    gte(leads.registeredAt, range.from),
    lte(leads.registeredAt, range.to),
    scope,
  );

  const [leadCounts] = await db.select({
    registered: sql<number>`count(*)::int`,
    contacted: sql<number>`count(*) filter (where ${leads.contactStatus} = 'contacted')::int`,
    qualified: sql<number>`count(*) filter (where ${leads.qualificationStatus} = 'qualified')::int`,
  }).from(leads).where(leadsInPeriod);

  // En cohorte, las reuniones y ventas se filtran por la fecha de registro
  // del LEAD; en actividad, por la fecha del propio hecho.
  const meetingWhere = mode === 'cohort'
    ? leadsInPeriod
    : and(gte(meetings.scheduledAt, range.from), lte(meetings.scheduledAt, range.to), scope);

  const [meetingCounts] = await db.select({
    booked: sql<number>`count(*)::int`,
    held: sql<number>`count(*) filter (where ${meetings.status} = 'completed')::int`,
    noShow: sql<number>`count(*) filter (where ${meetings.status} = 'no_show')::int`,
    leadsWithMeeting: sql<number>`count(distinct ${meetings.leadId})::int`,
  })
    .from(meetings)
    .innerJoin(leads, eq(leads.id, meetings.leadId))
    .where(meetingWhere);

  const saleWhere = mode === 'cohort'
    ? leadsInPeriod
    : and(gte(sales.closedAt, range.from), lte(sales.closedAt, range.to), scope);

  const [saleCounts] = await db.select({
    won: sql<number>`count(*)::int`,
    revenue: sql<number>`coalesce(sum(${sales.amountCents}), 0)::int`,
  })
    .from(sales)
    .innerJoin(leads, eq(leads.id, sales.leadId))
    .where(and(saleWhere, eq(sales.status, 'active')));

  return {
    registeredLeads: leadCounts.registered,
    contactedLeads: leadCounts.contacted,
    qualifiedLeads: leadCounts.qualified,
    leadsWithMeeting: meetingCounts.leadsWithMeeting,
    meetingsBooked: meetingCounts.booked,
    meetingsHeld: meetingCounts.held,
    noShows: meetingCounts.noShow,
    salesWon: saleCounts.won,
    revenueCents: saleCounts.revenue,
  };
}

export async function getKpis(range: Range): Promise<Kpis> {
  const f = await getFunnel(range);

  // Leads con al menos un intento de llamada: el denominador correcto del
  // contact rate. Dividir entre todos los leads castiga al setter por leads
  // que todavía no le tocaba llamar.
  const [attempted] = await db.select({
    n: sql<number>`count(distinct ${setterCalls.leadId})::int`,
  })
    .from(setterCalls)
    .innerJoin(leads, eq(leads.id, setterCalls.leadId))
    .where(and(gte(leads.registeredAt, range.from), lte(leads.registeredAt, range.to), launchCond(range)));

  /* show_rate: el denominador son las reuniones que LLEGARON a su hora sin
   * haberse cancelado con margen. Cancelar con 3 días de antelación no es
   * un no-show; cancelar 10 minutos antes, en la práctica, sí. */
  const eligibleForShow = f.meetingsHeld + f.noShows;

  const sampleWarning =
    f.meetingsHeld > 0 && f.meetingsHeld < 10
      ? `Muestra pequeña (${f.meetingsHeld} reuniones): los ratios todavía no son concluyentes.`
      : null;

  return {
    ...f,
    contactRate: ratio(f.contactedLeads, attempted.n),
    qualificationRateRegistered: ratio(f.qualifiedLeads, f.registeredLeads),
    qualificationRateContacted: ratio(f.qualifiedLeads, f.contactedLeads),
    bookingRateQualified: ratio(f.leadsWithMeeting, f.qualifiedLeads),
    showRate: ratio(f.meetingsHeld, eligibleForShow),
    // Dos close rates distintos, etiquetados. Un lead con 3 reuniones cuenta
    // 3 veces en el primero y 1 en el segundo: son preguntas diferentes.
    closeRateMeetings: ratio(f.salesWon, f.meetingsHeld),
    closeRateLeads: ratio(f.salesWon, f.leadsWithMeeting),
    avgTicketCents: f.salesWon ? Math.round(f.revenueCents / f.salesWon) : null,
    sampleWarning,
  };
}

/** Periodo inmediatamente anterior de la misma duración. */
export function previousRange(range: Range): Range {
  const ms = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - ms), to: new Date(range.from), mode: range.mode, launchIds: range.launchIds };
}

export function change(current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/* ── Cuello de botella ───────────────────────────────────────────────── */

export type Stage = { key: string; label: string; value: number; convFromPrev: number | null };

/**
 * El embudo cambia de forma segun el negocio.
 *
 * En Evergreen no hay reuniones: pintar "Reuniones agendadas 0" y despues
 * "Ventas 9" dibuja una caida al 0 % seguida de una resurreccion imposible.
 * Cuando no hay reuniones, la venta cuelga directamente de los cualificados.
 */
export function funnelStages(f: Funnel, opts: { withMeetings?: boolean } = {}): Stage[] {
  const withMeetings = opts.withMeetings ?? f.meetingsBooked > 0;

  const base: Stage[] = [
    { key: 'leads', label: 'Leads', value: f.registeredLeads, convFromPrev: null },
    { key: 'contacted', label: 'Contactados', value: f.contactedLeads, convFromPrev: ratio(f.contactedLeads, f.registeredLeads) },
    { key: 'qualified', label: 'Cualificados', value: f.qualifiedLeads, convFromPrev: ratio(f.qualifiedLeads, f.contactedLeads) },
  ];

  if (!withMeetings) {
    return [...base, { key: 'won', label: 'Ventas', value: f.salesWon, convFromPrev: ratio(f.salesWon, f.qualifiedLeads) }];
  }

  return [
    ...base,
    { key: 'booked', label: 'Reuniones agendadas', value: f.leadsWithMeeting, convFromPrev: ratio(f.leadsWithMeeting, f.qualifiedLeads) },
    { key: 'held', label: 'Reuniones realizadas', value: f.meetingsHeld, convFromPrev: ratio(f.meetingsHeld, f.meetingsBooked) },
    { key: 'won', label: 'Ventas', value: f.salesWon, convFromPrev: ratio(f.salesWon, f.meetingsHeld) },
  ];
}

/**
 * El mayor cuello de botella NO es siempre la etapa con menor porcentaje.
 * Una etapa que convierte al 30 % pero está en su nivel normal importa menos
 * que una que ha caído del 75 % al 60 %. Aquí se mira el volumen perdido,
 * que es lo que se puede recuperar.
 */
export function biggestDropoff(stages: Stage[]): Stage | null {
  let worst: Stage | null = null;
  let worstLoss = 0;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].value;
    const lost = prev - stages[i].value;
    if (prev >= 5 && lost > worstLoss) { worstLoss = lost; worst = stages[i]; }
  }
  return worst;
}

/* ── Por persona ─────────────────────────────────────────────────────── */

export async function setterStats(range: Range) {
  return db.select({
    setterId: setterCalls.setterId,
    attempts: sql<number>`count(*)::int`,
    answered: sql<number>`count(*) filter (where ${setterCalls.answered} = true)::int`,
    leadsAttempted: sql<number>`count(distinct ${setterCalls.leadId})::int`,
    qualified: sql<number>`count(*) filter (where ${setterCalls.qualification} = 'qualified')::int`,
  })
    .from(setterCalls)
    .where(and(gte(setterCalls.createdAt, range.from), lte(setterCalls.createdAt, range.to)))
    .groupBy(setterCalls.setterId);
}

export async function closerStats(range: Range) {
  return db.select({
    closerId: meetings.closerId,
    assigned: sql<number>`count(*)::int`,
    held: sql<number>`count(*) filter (where ${meetings.status} = 'completed')::int`,
    noShow: sql<number>`count(*) filter (where ${meetings.status} = 'no_show')::int`,
    won: sql<number>`count(*) filter (where ${meetings.commercialResult} = 'won')::int`,
    followUp: sql<number>`count(*) filter (where ${meetings.commercialResult} = 'follow_up')::int`,
  })
    .from(meetings)
    .where(and(
      isNotNull(meetings.closerId),
      gte(meetings.scheduledAt, range.from),
      lte(meetings.scheduledAt, range.to),
    ))
    .groupBy(meetings.closerId);
}

/* ── Atención requerida ──────────────────────────────────────────────── */

export type Alert = {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  explanation: string;
  href: string;
  count: number;
};

export async function needsAttention(launchIds?: string[] | null): Promise<Alert[]> {
  const out: Alert[] = [];
  // En Evergreen no existen reuniones: mostrar alertas de confirmacion 24h
  // seria pedirle al equipo que actue sobre algo del otro negocio.
  const inScope = !launchIds
    ? undefined
    : launchIds.length === 0 ? sql`false` : inArray(leads.launchId, launchIds);

  const [unconfirmed] = await db.select({ n: sql<number>`count(*)::int` })
    .from(meetings).innerJoin(leads, eq(leads.id, meetings.leadId))
    .where(and(
      eq(meetings.status, 'scheduled'),
      lte(meetings.scheduledAt, new Date(Date.now() + 24 * 3600_000)),
      gte(meetings.scheduledAt, new Date()),
      eq(meetings.confirmation24hStatus, 'pending'),
      inScope,
    ));
  if (unconfirmed.n > 0) {
    out.push({
      code: 'MEETINGS_UNCONFIRMED', severity: 'critical',
      title: `${unconfirmed.n} ${unconfirmed.n === 1 ? 'reunión' : 'reuniones'} sin confirmar`,
      explanation: 'Empiezan en menos de 24 h y nadie ha registrado la confirmación. Es la principal causa de no-show.',
      href: '/owner/tareas?tipo=confirm_meeting_24h', count: unconfirmed.n,
    });
  }

  const [noResult] = await db.select({ n: sql<number>`count(*)::int` })
    .from(meetings).innerJoin(leads, eq(leads.id, meetings.leadId))
    .where(and(
      eq(meetings.status, 'scheduled'),
      lte(meetings.scheduledAt, new Date(Date.now() - 2 * 3600_000)),
      inScope,
    ));
  if (noResult.n > 0) {
    out.push({
      code: 'MEETINGS_WITHOUT_RESULT', severity: 'critical',
      title: `${noResult.n} ${noResult.n === 1 ? 'reunión' : 'reuniones'} sin resultado`,
      explanation: 'Ya pasaron y no tienen resultado comercial. Mientras falten, el show rate y el close rate están mal.',
      href: '/owner/tareas?tipo=meeting_result', count: noResult.n,
    });
  }

  const [orphans] = await db.select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(
      eq(leads.qualificationStatus, 'qualified'),
      inArray(leads.status, ['qualified', 'contacted']),
      sql`${leads.nextActionAt} is null`,
      inScope,
    ));
  if (orphans.n > 0) {
    out.push({
      code: 'QUALIFIED_WITHOUT_ACTION', severity: 'warning',
      title: `${orphans.n} leads cualificados sin próxima acción`,
      explanation: 'Pasaron la cualificación y no tienen nada agendado. Se enfrían solos.',
      href: '/owner/leads?filtro=sin-accion', count: orphans.n,
    });
  }

  const [followUps] = await db.select({ n: sql<number>`count(*)::int` })
    .from(meetings).innerJoin(leads, eq(leads.id, meetings.leadId))
    .where(and(
      eq(meetings.commercialResult, 'follow_up'),
      lte(meetings.followUpAt, new Date()),
      inScope,
    ));
  if (followUps.n > 0) {
    out.push({
      code: 'FOLLOW_UP_OVERDUE', severity: 'warning',
      title: `${followUps.n} ${followUps.n === 1 ? 'seguimiento vencido' : 'seguimientos vencidos'}`,
      explanation: 'La fecha acordada ya pasó. Un seguimiento vencido es un lead que se pierde en silencio.',
      href: '/owner/leads?filtro=seguimiento', count: followUps.n,
    });
  }

  const [dupes] = await db.select({ n: sql<number>`count(*)::int` })
    .from(sql`lead_merge_candidates`)
    .where(sql`status = 'pending'`);
  if (dupes.n > 0) {
    out.push({
      code: 'DUPLICATES_PENDING', severity: 'info',
      title: `${dupes.n} posibles duplicados por revisar`,
      explanation: 'El sistema no los fusiona solo. Requieren decisión humana.',
      href: '/owner/leads?filtro=duplicados', count: dupes.n,
    });
  }

  return out;
}
