import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Card, PageHeader, Table, Td, Badge, EmptyState, Input } from '@/components/ui';
import { listLeads } from '@/domain/queries';
import { fmtDateTime, formatMoney } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import { label, tone, LEAD_STATUS, INTEREST_LEVEL } from '@/lib/labels';

export const dynamic = 'force-dynamic';

/** El closer ve solo los leads de sus reuniones. */
export default async function CloserLeads({
  searchParams,
}: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const { rows, total } = await listLeads({ kind: 'closer', userId: session.userId }, { search: sp.q });

  return (
    <Shell session={session} current="/closer/mis-leads">
      <PageHeader title="Mis leads" subtitle={`${total} con reunión asignada`} />

      <form className="mb-3" action="/closer/mis-leads">
        <Input name="q" defaultValue={sp.q} placeholder="Nombre, teléfono o LD-000123" className="max-w-sm" />
      </form>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Todavía no tienes leads asignados." />
        ) : (
          <Table head={['Lead', 'Estado', 'Interés', 'Próxima acción', 'Revenue']}>
            {rows.map(({ lead }) => (
              <tr key={lead.id} className="hover:bg-neutral-50">
                <Td>
                  <Link href={`/owner/leads/${lead.id}`} className="font-medium hover:underline">
                    {lead.fullName}
                  </Link>
                  <div className="tnum text-xs text-neutral-500">
                    {lead.publicId} · {formatPhone(lead.phoneNormalized)}
                  </div>
                </Td>
                <Td><Badge tone={tone(LEAD_STATUS, lead.status)}>{label(LEAD_STATUS, lead.status)}</Badge></Td>
                <Td className="text-xs">{lead.interestLevel ? label(INTEREST_LEVEL, lead.interestLevel) : '—'}</Td>
                <Td className="text-xs">{lead.nextActionAt ? fmtDateTime(lead.nextActionAt) : '—'}</Td>
                <Td className="tnum text-xs">{lead.revenueCents ? formatMoney(lead.revenueCents) : '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </Shell>
  );
}
