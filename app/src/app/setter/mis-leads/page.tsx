import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Card, PageHeader, Table, Td, Badge, EmptyState, Input, LinkButton } from '@/components/ui';
import { listLeads } from '@/domain/queries';
import { fmtDateTime } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import {
  label, tone, LEAD_STATUS, CONTACT_STATUS, QUALIFICATION_STATUS, INTEREST_LEVEL,
} from '@/lib/labels';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: '', label: 'Todos' },
  { key: 'nuevos', label: 'Sin contactar' },
  { key: 'cualificados', label: 'Cualificados' },
  { key: 'no-cualificados', label: 'No cualificados' },
  { key: 'con-reunion', label: 'Con reunión' },
  { key: 'no-contactables', label: 'No contactables' },
];

/** El setter ve SOLO sus leads. El alcance se aplica en el WHERE, no
 *  filtrando en memoria después de traerlos todos. */
export default async function MisLeads({
  searchParams,
}: { searchParams: Promise<{ q?: string; filtro?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const { rows, total } = await listLeads(
    { kind: 'setter', userId: session.userId },
    { search: sp.q, quickFilter: sp.filtro },
  );

  return (
    <Shell session={session} current="/setter/mis-leads">
      <PageHeader title="Mis leads" subtitle={`${total} asignados`} />

      <form className="mb-3" action="/setter/mis-leads">
        <Input name="q" defaultValue={sp.q} placeholder="Nombre, teléfono o LD-000123" className="max-w-sm" />
      </form>

      <div className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <LinkButton key={f.key} size="sm"
            href={`/setter/mis-leads${f.key ? `?filtro=${f.key}` : ''}`}
            variant={(sp.filtro ?? '') === f.key ? 'primary' : 'secondary'}>{f.label}</LinkButton>
        ))}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No hay leads asignados con estos filtros." />
        ) : (
          <Table head={['Lead', 'Estado', 'Contacto', 'Cualificación', 'Interés', 'Próxima acción']}>
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
                <Td><Badge tone={tone(CONTACT_STATUS, lead.contactStatus)}>{label(CONTACT_STATUS, lead.contactStatus)}</Badge></Td>
                <Td><Badge tone={tone(QUALIFICATION_STATUS, lead.qualificationStatus)}>{label(QUALIFICATION_STATUS, lead.qualificationStatus)}</Badge></Td>
                <Td className="text-xs">{lead.interestLevel ? label(INTEREST_LEVEL, lead.interestLevel) : '—'}</Td>
                <Td className="text-xs">{lead.nextActionAt ? fmtDateTime(lead.nextActionAt) : '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </Shell>
  );
}
