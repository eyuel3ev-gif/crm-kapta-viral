import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Card, PageHeader, Badge, Row, LinkButton } from '@/components/ui';
import { getCallDetail } from '@/domain/queries';
import { CallForm } from './call-form';
import { fmtDateTime } from '@/lib/format';
import { formatPhone, telHref } from '@/lib/phone';
import { label, tone, CALL_TYPE, INTEREST_LEVEL, QUALIFICATION_STATUS } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function LlamadaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const data = await getCallDetail(id);
  if (!data) notFound();

  const { call, lead, questions, priorCalls, profileAnswers, meeting } = data;

  return (
    <Shell session={session} current="/setter/mi-trabajo">
      <PageHeader
        title={lead.fullName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tnum">{lead.publicId}</span>
            <Badge tone={tone(CALL_TYPE, call.callType)}>{label(CALL_TYPE, call.callType)}</Badge>
            {call.attemptNumber > 1 && <Badge tone="warning">Intento {call.attemptNumber}</Badge>}
          </span>
        }
        actions={
          <>
            {lead.phoneNormalized && (
              <a href={telHref(lead.phoneNormalized)}
                className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800">
                Llamar {formatPhone(lead.phoneNormalized)}
              </a>
            )}
            <LinkButton href="/setter/mi-trabajo">Volver</LinkButton>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          <CallForm callId={call.id} callType={call.callType}
            questions={questions.map((q) => ({
              id: q.id, code: q.code, questionText: q.questionText, required: q.required,
            }))} />
        </div>

        {/* Contexto antes de descolgar. El setter tiene que entender quién es
            esta persona en menos de 20 segundos. */}
        <aside className="space-y-4">
          {meeting && (
            <Card title="Reunión">
              <div className="px-4 py-3">
                <Row label="Fecha">{fmtDateTime(meeting.scheduledAt)}</Row>
                <Row label="Estado">{meeting.status}</Row>
              </div>
            </Card>
          )}

          <Card title="Lo que ya sabemos">
            <div className="px-4 py-3">
              <Row label="Estado">
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
              {profileAnswers.length === 0 ? (
                <p className="pt-2 text-xs text-neutral-500">
                  No rellenó el formulario de perfil. Habrá que preguntarlo todo.
                </p>
              ) : (
                profileAnswers.map((a, i) => (
                  <Row key={i} label={a.question}>{a.answer ?? '—'}</Row>
                ))
              )}
            </div>
          </Card>

          {priorCalls.length > 0 && (
            <Card title="Llamadas anteriores">
              <ul className="divide-y divide-neutral-100">
                {priorCalls.map((c) => (
                  <li key={c.id} className="px-4 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{label(CALL_TYPE, c.callType)} · intento {c.attemptNumber}</span>
                      <Badge tone={c.answered ? 'positive' : 'neutral'}>
                        {c.answered ? 'Contestó' : 'No contestó'}
                      </Badge>
                    </div>
                    <div className="text-neutral-500">{fmtDateTime(c.completedAt ?? c.scheduledAt)}</div>
                    {c.notes && <p className="mt-1 text-neutral-600">{c.notes}</p>}
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
