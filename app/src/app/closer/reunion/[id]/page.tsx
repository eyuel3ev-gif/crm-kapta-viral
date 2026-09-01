import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Card, PageHeader, Badge, Row, LinkButton, EmptyState } from '@/components/ui';
import { getMeetingDetail } from '@/domain/queries';
import { ResultForm } from './result-form';
import { fmtDateTime, formatMoney } from '@/lib/format';
import { formatPhone, telHref } from '@/lib/phone';
import {
  label, tone, CONFIRMATION_24H, INTEREST_LEVEL, QUALIFICATION_STATUS,
  COMMERCIAL_RESULT, MEETING_STATUS, CALL_TYPE,
} from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function ReunionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const data = await getMeetingDetail(id);
  if (!data) notFound();

  const {
    meeting, lead, priorMeetings, calls, callAnswers, profileAnswers, lossReasons,
  } = data;

  const call24h = calls.find((c) => c.call.callType === 'meeting_24h');
  const call1 = calls.find((c) => c.call.callType === 'post_class_1');

  return (
    <Shell session={session} current="/closer/reuniones">
      <PageHeader
        title={lead.fullName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tnum">{lead.publicId}</span>
            <Badge>Reunión #{meeting.meetingNumber}</Badge>
            <Badge tone={tone(MEETING_STATUS, meeting.status)}>{label(MEETING_STATUS, meeting.status)}</Badge>
            <Badge tone={tone(COMMERCIAL_RESULT, meeting.commercialResult)}>
              {label(COMMERCIAL_RESULT, meeting.commercialResult)}
            </Badge>
            <span className="text-neutral-500">{fmtDateTime(meeting.scheduledAt)}</span>
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
            <LinkButton href="/closer/reuniones">Volver</LinkButton>
          </>
        }
      />

      {meeting.confirmation24hStatus === 'pending' && meeting.status === 'scheduled' && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No hay confirmación de 24 h registrada. La reunión sigue en pie, pero
          entra con más riesgo de no-show.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          <ResultForm
            meetingId={meeting.id}
            lossReasons={lossReasons.map((r) => ({ code: r.code, label: r.label }))}
            defaults={{ notes: meeting.notes, phantomUrl: meeting.phantomUrl }}
          />
        </div>

        {/* Handoff del setter. El closer no debería tener que preguntar nada
            de esto otra vez: ya lo contestó el lead. */}
        <aside className="space-y-4">
          <Card title="Antes de entrar">
            <div className="px-4 py-3">
              <Row label="Cualificación">
                <Badge tone={tone(QUALIFICATION_STATUS, lead.qualificationStatus)}>
                  {label(QUALIFICATION_STATUS, lead.qualificationStatus)}
                </Badge>
              </Row>
              {lead.interestLevel && (
                <Row label="Interés">
                  <Badge tone={tone(INTEREST_LEVEL, lead.interestLevel)}>
                    {label(INTEREST_LEVEL, lead.interestLevel)}
                  </Badge>
                </Row>
              )}
              <Row label="Confirmación 24 h">
                <Badge tone={tone(CONFIRMATION_24H, meeting.confirmation24hStatus ?? 'pending')}>
                  {label(CONFIRMATION_24H, meeting.confirmation24hStatus ?? 'pending')}
                </Badge>
              </Row>
              <Row label="Asistió al directo">
                {/* NULL, no "No". Con enlace genérico de Zoom no lo sabemos,
                    y fabricar un false contaminaría todo el análisis. */}
                {lead.webinarAttended === null
                  ? <span className="text-xs italic text-neutral-400">Sin datos individuales</span>
                  : lead.webinarAttended ? 'Sí' : 'No'}
              </Row>
              {lead.revenueCents > 0 && (
                <Row label="Revenue"><strong>{formatMoney(lead.revenueCents)}</strong></Row>
              )}
            </div>
          </Card>

          {call24h && (
            <Card title="Confirmación 24 h">
              <div className="px-4 py-3">
                {callAnswers.filter((a) => a.callId === call24h.call.id).map((a, i) => (
                  <Row key={i} label={a.question}>{a.answer ?? '—'}</Row>
                ))}
                {call24h.call.notes && (
                  <p className="mt-2 text-xs text-neutral-600">{call24h.call.notes}</p>
                )}
              </div>
            </Card>
          )}

          {call1 && (
            <Card title={`Cualificación · ${call1.setterName ?? 'Setter'}`}>
              <div className="px-4 py-3">
                {callAnswers.filter((a) => a.callId === call1.call.id).map((a, i) => (
                  <Row key={i} label={a.question}>{a.answer ?? '—'}</Row>
                ))}
                {call1.call.notes && (
                  <p className="mt-2 rounded bg-neutral-50 px-2 py-1.5 text-xs text-neutral-700">
                    {call1.call.notes}
                  </p>
                )}
              </div>
            </Card>
          )}

          {profileAnswers.length > 0 && (
            <Card title="Formulario">
              <div className="px-4 py-3">
                {profileAnswers.map((a, i) => <Row key={i} label={a.question}>{a.answer ?? '—'}</Row>)}
              </div>
            </Card>
          )}

          {priorMeetings.length > 0 && (
            <Card title="Reuniones anteriores">
              <ul className="divide-y divide-neutral-100">
                {priorMeetings.map((p) => (
                  <li key={p.meeting.id} className="px-4 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Reunión #{p.meeting.meetingNumber}</span>
                      <Badge tone={tone(COMMERCIAL_RESULT, p.meeting.commercialResult)}>
                        {label(COMMERCIAL_RESULT, p.meeting.commercialResult)}
                      </Badge>
                    </div>
                    <div className="text-neutral-500">{fmtDateTime(p.meeting.scheduledAt)}</div>
                    {p.lossLabel && <div className="text-neutral-600">Motivo: {p.lossLabel}</div>}
                    {p.meeting.followUpReason && (
                      <div className="text-neutral-600">{p.meeting.followUpReason}</div>
                    )}
                    {p.meeting.notes && <p className="mt-1 text-neutral-600">{p.meeting.notes}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </Shell>
  );
}
