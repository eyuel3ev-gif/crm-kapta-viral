import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { leadScopeFor } from '@/lib/permissions';
import { Shell } from '@/components/shell';
import { Card, PageHeader, Table, Td, Badge, EmptyState, Input, LinkButton } from '@/components/ui';
import { listLeads } from '@/domain/queries';
import { resolveScope } from '@/lib/scope';
import { fmtDateTime, formatMoney } from '@/lib/format';
import { formatPhone } from '@/lib/phone';
import {
  label, tone, LEAD_STATUS, CONTACT_STATUS, QUALIFICATION_STATUS, INTEREST_LEVEL, SOURCE,
} from '@/lib/labels';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: '', label: 'Todos' },
  { key: 'nuevos', label: 'Nuevos' },
  { key: 'cualificados', label: 'Cualificados' },
  { key: 'con-reunion', label: 'Con reunión' },
  { key: 'seguimiento', label: 'Seguimiento' },
  { key: 'ganados', label: 'Ganados' },
  { key: 'perdidos', label: 'Perdidos' },
  { key: 'sin-accion', label: 'Sin próxima acción' },
  { key: 'no-contactables', label: 'No contactables' },
];

export default async function LeadsPage({
  searchParams,
}: { searchParams: Promise<{ q?: string; filtro?: string; page?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const scope = await resolveScope();
  const { rows, total, page, totalPages } = await listLeads(leadScopeFor(session), {
    search: sp.q, quickFilter: sp.filtro, page: Number(sp.page ?? 1),
    launchIds: scope.launchIds,
  });

  return (
    <Shell session={session} current="/owner/leads">
      <PageHeader title="Leads" subtitle={`${scope.label} · ${total} en total`} />

      <form className="mb-3 flex gap-2" action="/owner/leads">
        <Input name="q" defaultValue={sp.q} placeholder="Nombre, teléfono, email o LD-000123"
          className="max-w-sm" />
        {sp.filtro && <input type="hidden" name="filtro" value={sp.filtro} />}
      </form>

      <div className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <LinkButton key={f.key} size="sm"
            href={`/owner/leads${f.key ? `?filtro=${f.key}` : ''}`}
            variant={(sp.filtro ?? '') === f.key ? 'primary' : 'secondary'}>
            {f.label}
          </LinkButton>
        ))}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No hay leads con estos filtros." />
        ) : (
          <Table head={['Lead', 'Estado', 'Contacto', 'Cualificación', 'Interés', 'Origen', 'Setter', 'Próxima acción', 'Revenue']}>
            {rows.map(({ lead, setterName, source, campaign }) => (
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
                <Td className="text-xs">
                  {label(SOURCE, source ?? 'unknown')}
                  {campaign && <div className="text-neutral-400">{campaign}</div>}
                </Td>
                <Td className="text-xs">{setterName ?? '—'}</Td>
                <Td className="text-xs">{lead.nextActionAt ? fmtDateTime(lead.nextActionAt) : '—'}</Td>
                <Td className="tnum text-xs">{lead.revenueCents ? formatMoney(lead.revenueCents) : '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-neutral-600">
          <span>Página {page} de {totalPages}</span>
          {page > 1 && <LinkButton size="sm" href={`/owner/leads?page=${page - 1}&filtro=${sp.filtro ?? ''}`}>Anterior</LinkButton>}
          {page < totalPages && <LinkButton size="sm" href={`/owner/leads?page=${page + 1}&filtro=${sp.filtro ?? ''}`}>Siguiente</LinkButton>}
        </div>
      )}
    </Shell>
  );
}
