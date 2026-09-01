import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Card, PageHeader, Badge, EmptyState, LinkButton } from '@/components/ui';
import { getCloserMeetings } from '@/domain/queries';
import { fmtDateTime, fmtTime, fmtRelative, formatMoney } from '@/lib/format';
import {
  label, tone, CONFIRMATION_24H, INTEREST_LEVEL, QUALIFICATION_STATUS, COMMERCIAL_RESULT,
} from '@/lib/labels';

export const dynamic = 'force-dynamic';

type Row = Awaited<ReturnType<typeof getCloserMeetings>>['today'][number];

function MeetingRow({ row, showDate }: { row: Row; showDate?: boolean }) {
  const { meeting, lead, setterName } = row;
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3 hover:bg-neutral-50">
      <div className="w-20 shrink-0">
        <div className="tnum text-sm font-semibold">{fmtTime(meeting.scheduledAt)}</div>
        <div className="text-[11px] text-neutral-400">
          {showDate ? fmtDateTime(meeting.scheduledAt) : fmtRelative(meeting.scheduledAt)}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{lead.fullName}</span>
          <Badge>Reunión #{meeting.meetingNumber}</Badge>
          <Badge tone={tone(QUALIFICATION_STATUS, lead.qualificationStatus)}>
            {label(QUALIFICATION_STATUS, lead.qualificationStatus)}
          </Badge>
          {lead.interestLevel && (
            <Badge tone={tone(INTEREST_LEVEL, lead.interestLevel)}>
              Interés {label(INTEREST_LEVEL, lead.interestLevel).toLowerCase()}
            </Badge>
          )}
          {/* Aviso, no bloqueo: una reunión sin confirmar se celebra igual,
              pero el closer debe saber que entra con más riesgo de no-show. */}
          <Badge tone={tone(CONFIRMATION_24H, meeting.confirmation24hStatus ?? 'pending')}>
            24 h: {label(CONFIRMATION_24H, meeting.confirmation24hStatus ?? 'pending')}
          </Badge>
          {meeting.commercialResult !== 'pending' && (
            <Badge tone={tone(COMMERCIAL_RESULT, meeting.commercialResult)}>
              {label(COMMERCIAL_RESULT, meeting.commercialResult)}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">
          {lead.publicId} · Setter: {setterName ?? '—'}
          {lead.revenueCents > 0 && ` · ${formatMoney(lead.revenueCents)}`}
        </p>
      </div>

      <LinkButton size="sm" variant="primary" href={`/closer/reunion/${meeting.id}`}>
        Abrir
      </LinkButton>
    </li>
  );
}

export default async function Reuniones() {
  const session = await getSession();
  if (!session) redirect('/login');

  const m = await getCloserMeetings(session.userId);

  return (
    <Shell session={session} current="/closer/reuniones">
      <PageHeader title="Reuniones" subtitle={`Hola, ${session.name.split(' ')[0]}`} />

      <div className="space-y-4">
        {/* Lo primero es lo que ya pasó y sigue sin registrar: mientras falte,
            el show rate y el close rate del negocio están mal. */}
        {m.pendingResult.length > 0 && (
          <Card title={`Sin resultado registrado · ${m.pendingResult.length}`}>
            <ul className="divide-y divide-neutral-100">
              {m.pendingResult.map((r) => <MeetingRow key={r.meeting.id} row={r} showDate />)}
            </ul>
          </Card>
        )}

        <Card title={`Hoy · ${m.today.length}`}>
          {m.today.length === 0
            ? <EmptyState title="No tienes reuniones hoy." />
            : <ul className="divide-y divide-neutral-100">
                {m.today.map((r) => <MeetingRow key={r.meeting.id} row={r} />)}
              </ul>}
        </Card>

        <Card title={`Próximas · ${m.upcoming.length}`}>
          {m.upcoming.length === 0
            ? <EmptyState title="Sin reuniones próximas." />
            : <ul className="divide-y divide-neutral-100">
                {m.upcoming.slice(0, 15).map((r) => <MeetingRow key={r.meeting.id} row={r} showDate />)}
              </ul>}
        </Card>

        {m.followUps.length > 0 && (
          <Card title={`Seguimientos · ${m.followUps.length}`}>
            <ul className="divide-y divide-neutral-100">
              {m.followUps.map((r) => (
                <li key={r.meeting.id} className="flex items-start gap-3 px-4 py-3 hover:bg-neutral-50">
                  <div className="min-w-0 flex-1">
                    <Link href={`/closer/reunion/${r.meeting.id}`} className="font-medium hover:underline">
                      {r.lead.fullName}
                    </Link>
                    <p className="mt-0.5 text-xs text-neutral-600">{r.meeting.followUpReason}</p>
                    <p className="text-xs text-neutral-400">
                      Próxima acción: {r.meeting.nextAction ?? '—'} · {fmtDateTime(r.meeting.followUpAt)}
                    </p>
                  </div>
                  <LinkButton size="sm" href={`/closer/reunion/${r.meeting.id}`}>Abrir</LinkButton>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {m.noShows.length > 0 && (
          <Card title={`No-shows · ${m.noShows.length}`}>
            <div className="px-4 py-2 text-xs text-neutral-500">
              Un no-show no es una pérdida: son leads que se pueden reagendar.
            </div>
            <ul className="divide-y divide-neutral-100">
              {m.noShows.map((r) => <MeetingRow key={r.meeting.id} row={r} showDate />)}
            </ul>
          </Card>
        )}
      </div>
    </Shell>
  );
}
