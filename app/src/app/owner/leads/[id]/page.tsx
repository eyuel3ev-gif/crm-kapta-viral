import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import {
  Card, PageHeader, Badge, Row, Tabs, EmptyState, LinkButton, Unknown,
} from '@/components/ui';
import { getLeadProfile } from '@/domain/queries';
import { fmtDate, fmtDateTime, formatMoney } from '@/lib/format';
import { formatPhone, telHref } from '@/lib/phone';
import {
  label, tone, LEAD_STATUS, CONTACT_STATUS, QUALIFICATION_STATUS, INTEREST_LEVEL,
  SOURCE, CALL_TYPE, MEETING_STATUS, COMMERCIAL_RESULT, TASK_TYPE, TASK_PRIORITY,
  ATTENDANCE_INTENT,
} from '@/lib/labels';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'datos', label: 'Datos' },
  { key: 'formularios', label: 'Formularios' },
  { key: 'llamadas', label: 'Llamadas' },
  { key: 'reuniones', label: 'Reuniones' },
  { key: 'actividad', label: 'Actividad' },
  { key: 'pendientes', label: 'Pendientes' },
];

export default async function LeadProfile({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const { tab = 'datos' } = await searchParams;
  const data = await getLeadProfile(id);
  if (!data) notFound();

  const {
    lead, setterName, attribution, calls, callAnswers, meetings,
    activity, pending, submissions, answers,
  } = data;

  const tabs = TABS.map((t) => ({
    ...t,
    count: t.key === 'llamadas' ? calls.length
      : t.key === 'reuniones' ? meetings.length
      : t.key === 'pendientes' ? pending.length
      : undefined,
  }));

  return (
    <Shell session={session} current="/owner/leads">
      <PageHeader
        title={lead.fullName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tnum">{lead.publicId}</span>
            <Badge tone={tone(LEAD_STATUS, lead.status)}>{label(LEAD_STATUS, lead.status)}</Badge>
            <Badge tone={tone(CONTACT_STATUS, lead.contactStatus)}>{label(CONTACT_STATUS, lead.contactStatus)}</Badge>
            <Badge tone={tone(QUALIFICATION_STATUS, lead.qualificationStatus)}>
              {label(QUALIFICATION_STATUS, lead.qualificationStatus)}
            </Badge>
            {lead.interestLevel && (
              <Badge tone={tone(INTEREST_LEVEL, lead.interestLevel)}>
                Interés {label(INTEREST_LEVEL, lead.interestLevel).toLowerCase()}
              </Badge>
            )}
            {lead.revenueCents > 0 && <Badge tone="positive">{formatMoney(lead.revenueCents)}</Badge>}
          </span>
        }
        actions={
          <>
            {lead.phoneNormalized && (
              <a href={telHref(lead.phoneNormalized)}
                className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">
                {formatPhone(lead.phoneNormalized)}
              </a>
            )}
            <LinkButton href="/owner/leads">Volver</LinkButton>
          </>
        }
      />

      <Tabs tabs={tabs} active={tab} base={`/owner/leads/${id}`} />

      <div className="mt-4">
        {tab === 'datos' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Contacto">
              <div className="px-4 py-3">
                <Row label="Nombre">{lead.fullName}</Row>
                <Row label="WhatsApp">{formatPhone(lead.phoneNormalized)}</Row>
                <Row label="Email">{lead.emailNormalized ?? <Unknown />}</Row>
                <Row label="Ciudad">{lead.city ?? <Unknown />}</Row>
                <Row label="Registro">{fmtDateTime(lead.registeredAt)}</Row>
                <Row label="Setter">{setterName ?? <Unknown label="Sin asignar" />}</Row>
                <Row label="Próxima acción">
                  {lead.nextActionAt
                    ? `${lead.nextActionType ?? 'Acción'} · ${fmtDateTime(lead.nextActionAt)}`
                    : <Unknown label="Ninguna" />}
                </Row>
                <Row label="Asistió al directo">
                  {/* Sin tracking individual fiable, esto es NULL — no "No". */}
                  {lead.webinarAttended === null
                    ? <Unknown label="Sin datos individuales" />
                    : lead.webinarAttended ? 'Sí' : 'No'}
                </Row>
              </div>
            </Card>

            <Card title="Atribución">
              <div className="px-4 py-3">
                {attribution ? (
                  <>
                    <Row label="Origen">
                      <Badge tone={tone(SOURCE, attribution.source)}>{label(SOURCE, attribution.source)}</Badge>
                    </Row>
                    <Row label="Campaña">{attribution.campaignName ?? <Unknown />}</Row>
                    <Row label="Campaign ID"><span className="tnum text-xs">{attribution.campaignId ?? '—'}</span></Row>
                    <Row label="Anuncio">{attribution.adName ?? <Unknown />}</Row>
                    <Row label="Ad ID"><span className="tnum text-xs">{attribution.adId ?? '—'}</span></Row>
                    <Row label="UTM source">{attribution.utmSource ?? <Unknown />}</Row>
                    <Row label="Capturada">{fmtDateTime(attribution.capturedAt)}</Row>
                  </>
                ) : (
                  <EmptyState title="Sin datos de atribución." />
                )}
                <p className="mt-3 border-t border-neutral-100 pt-2 text-xs text-neutral-500">
                  La atribución es de solo lectura. Corregirla exige acción explícita
                  del Owner y queda registrada en el Audit Log.
                </p>
              </div>
            </Card>
          </div>
        )}

        {tab === 'formularios' && (
          <div className="space-y-4">
            {submissions.length === 0 ? (
              <Card><EmptyState title="No ha rellenado ningún formulario." /></Card>
            ) : submissions.map((s) => (
              <Card key={s.submissionId} title={`${s.formName} · ${fmtDate(s.submittedAt)}`}>
                <div className="px-4 py-3">
                  {answers.filter((a) => a.submissionId === s.submissionId).map((a, i) => (
                    <Row key={i} label={a.question}>{a.answer ?? '—'}</Row>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === 'llamadas' && (
          <div className="space-y-4">
            {calls.length === 0 ? (
              <Card><EmptyState title="Todavía no se le ha llamado." /></Card>
            ) : calls.map(({ call, setterName: sn }) => (
              <Card key={call.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {label(CALL_TYPE, call.callType)}
                    <Badge tone="neutral">Intento {call.attemptNumber}</Badge>
                    {call.answered === true && <Badge tone="positive">Contestó</Badge>}
                    {call.answered === false && <Badge tone="neutral">No contestó</Badge>}
                    {call.answered === null && <Badge tone="info">Programada</Badge>}
                  </span>
                }
                action={<span className="text-xs text-neutral-500">{sn}</span>}
              >
                <div className="px-4 py-3">
                  <Row label="Fecha">{fmtDateTime(call.completedAt ?? call.scheduledAt)}</Row>
                  {call.qualification && (
                    <Row label="Cualificación">
                      <Badge tone={call.qualification === 'qualified' ? 'positive' : 'negative'}>
                        {call.qualification === 'qualified' ? 'Cualificado' : 'No cualificado'}
                      </Badge>
                      {call.disqualificationReason && (
                        <span className="ml-2 text-xs text-neutral-600">{call.disqualificationReason}</span>
                      )}
                    </Row>
                  )}
                  {call.interestLevel && (
                    <Row label="Interés">{label(INTEREST_LEVEL, call.interestLevel)}</Row>
                  )}
                  {call.attendanceIntent && (
                    <Row label="Directo">{label(ATTENDANCE_INTENT, call.attendanceIntent)}</Row>
                  )}
                  {callAnswers.filter((a) => a.callId === call.id).map((a, i) => (
                    <Row key={i} label={a.question}>{a.answer ?? '—'}</Row>
                  ))}
                  {call.notes && (
                    <div className="mt-2 rounded bg-neutral-50 px-2 py-1.5 text-xs text-neutral-700">
                      {call.notes}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === 'reuniones' && (
          <div className="space-y-4">
            {meetings.length === 0 ? (
              <Card><EmptyState title="No tiene reuniones." /></Card>
            ) : meetings.map(({ meeting: m, closerName, lossLabel }) => (
              <Card key={m.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    Reunión #{m.meetingNumber}
                    <Badge tone={tone(MEETING_STATUS, m.status)}>{label(MEETING_STATUS, m.status)}</Badge>
                    <Badge tone={tone(COMMERCIAL_RESULT, m.commercialResult)}>
                      {label(COMMERCIAL_RESULT, m.commercialResult)}
                    </Badge>
                  </span>
                }
                action={<LinkButton size="sm" href={`/closer/reunion/${m.id}`}>Abrir</LinkButton>}
              >
                <div className="px-4 py-3">
                  <Row label="Fecha">{fmtDateTime(m.scheduledAt)}</Row>
                  <Row label="Closer">{closerName ?? <Unknown />}</Row>
                  {lossLabel && <Row label="Motivo de pérdida">{lossLabel}</Row>}
                  {m.followUpReason && <Row label="Seguimiento">{m.followUpReason}</Row>}
                  {m.followUpAt && <Row label="Próxima acción">{fmtDateTime(m.followUpAt)}</Row>}
                  {m.phantomUrl && (
                    <Row label="Grabación">
                      <a href={m.phantomUrl} target="_blank" rel="noreferrer"
                        className="text-xs underline">Abrir grabación</a>
                    </Row>
                  )}
                  {m.notes && (
                    <div className="mt-2 rounded bg-neutral-50 px-2 py-1.5 text-xs text-neutral-700">{m.notes}</div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === 'actividad' && (
          <Card title="Historia del lead">
            {activity.length === 0 ? (
              <EmptyState title="Sin actividad registrada." />
            ) : (
              <ul className="divide-y divide-neutral-100">
                {activity.map(({ a, actorName }) => (
                  <li key={a.id} className="flex gap-3 px-4 py-2">
                    <span className="tnum w-32 shrink-0 text-xs text-neutral-400">
                      {fmtDateTime(a.occurredAt)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-neutral-900">{a.title}</p>
                      {a.description && <p className="text-xs text-neutral-500">{a.description}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {actorName ?? (a.actorType === 'system' ? 'sistema' : a.actorType)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {tab === 'pendientes' && (
          <Card title="Tareas abiertas">
            {pending.length === 0 ? (
              <EmptyState title="No hay tareas abiertas para este lead." />
            ) : (
              <ul className="divide-y divide-neutral-100">
                {pending.map(({ task, assigneeName }) => (
                  <li key={task.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{task.title}</span>
                      <Badge tone={tone(TASK_TYPE, task.taskType)}>{label(TASK_TYPE, task.taskType)}</Badge>
                      <Badge tone={tone(TASK_PRIORITY, task.priority)}>{label(TASK_PRIORITY, task.priority)}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-neutral-600">{task.reason ?? task.description}</p>
                    <p className="text-xs text-neutral-400">
                      {assigneeName ?? 'Sin responsable'} · {fmtDateTime(task.dueAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </Shell>
  );
}
