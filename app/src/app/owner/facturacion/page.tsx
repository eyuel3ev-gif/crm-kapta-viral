import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { Shell } from '@/components/shell';
import {
  Card, PageHeader, Stat, Table, Td, Badge, EmptyState, LinkButton,
} from '@/components/ui';
import { getBilling } from '@/domain/queries';
import { resolveScope } from '@/lib/scope';
import { fmtDate, fmtDateTime, formatMoney, fmtNumber, isOverdue } from '@/lib/format';

export const dynamic = 'force-dynamic';

const SALE_STATUS: Record<string, { label: string; tone: 'positive' | 'negative' | 'warning' | 'neutral' }> = {
  active: { label: 'Activa', tone: 'positive' },
  refunded: { label: 'Reembolsada', tone: 'negative' },
  defaulted: { label: 'Impagada', tone: 'negative' },
  corrected: { label: 'Corregida', tone: 'warning' },
  cancelled: { label: 'Cancelada', tone: 'neutral' },
};

const SOURCE: Record<string, string> = {
  crm: 'Reunión', hotmart: 'Hotmart', manual: 'Manual',
};

export default async function Facturacion({
  searchParams,
}: { searchParams: Promise<{ dias?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');
  // Solo propietarios. El setter y el closer no ven facturación global.
  if (!can(session, 'analytics.read_global')) redirect('/');

  const sp = await searchParams;
  const days = Number(sp.dias ?? 30);
  const scope = await resolveScope();
  const range = { from: new Date(Date.now() - days * 86400_000), to: new Date(), launchIds: scope.launchIds };

  const { totals, cash, rows, upcoming } = await getBilling(range);

  return (
    <Shell session={session} current="/owner/facturacion">
      <PageHeader
        title="Facturación"
        subtitle={`${scope.label} · últimos ${days} días`}
        actions={
          <div className="flex gap-1">
            {[30, 90, 365].map((d) => (
              <LinkButton key={d} size="sm" href={`/owner/facturacion?dias=${d}`}
                variant={d === days ? 'primary' : 'secondary'}>
                {d === 365 ? '1 año' : `${d} d`}
              </LinkButton>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue contratado" value={formatMoney(totals.contractedCents)}
          hint={`${fmtNumber(totals.salesCount)} ventas`} />
        <Stat label="Cash collected" value={formatMoney(cash.collectedCents)}
          hint="dinero que ya ha entrado" />
        <Stat label="Pendiente de cobro" value={formatMoney(cash.pendingCents)}
          hint={cash.overdueCents > 0 ? `${formatMoney(cash.overdueCents)} vencido` : 'al corriente'} />
        <Stat label="Reembolsado" value={formatMoney(totals.refundedCents)}
          hint={`${fmtNumber(totals.refundedCount)} operaciones`} />
      </div>

      {/* La diferencia entre lo vendido y lo cobrado no es un matiz contable:
          con financiación a plazos son meses de desfase. */}
      {totals.contractedCents > cash.collectedCents && (
        <p className="mt-3 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600">
          Se ha vendido <strong>{formatMoney(totals.contractedCents)}</strong> y ha entrado{' '}
          <strong>{formatMoney(cash.collectedCents)}</strong>. La diferencia son cuotas
          futuras, no dinero perdido — pero tampoco es dinero que tengas todavía.
        </p>
      )}

      <div className="mt-6 space-y-4">
        {upcoming.length > 0 && (
          <Card title={`Cuotas pendientes · ${upcoming.length}`}>
            <Table head={['Lead', 'Cuota', 'Importe', 'Vence', 'Estado']}>
              {upcoming.map(({ payment, lead }) => {
                const overdue = isOverdue(payment.dueAt);
                return (
                  <tr key={payment.id} className="hover:bg-neutral-50">
                    <Td>
                      <Link href={`/owner/leads/${lead.id}`} className="font-medium hover:underline">
                        {lead.fullName}
                      </Link>
                      <div className="tnum text-xs text-neutral-500">{lead.publicId}</div>
                    </Td>
                    <Td className="text-xs">{payment.installmentNumber ? `#${payment.installmentNumber}` : '—'}</Td>
                    <Td className="tnum">{formatMoney(payment.amountCents, payment.currency)}</Td>
                    <Td className={`text-xs ${overdue ? 'font-medium text-red-700' : ''}`}>
                      {fmtDate(payment.dueAt)}
                    </Td>
                    <Td>
                      <Badge tone={overdue ? 'negative' : 'warning'}>
                        {overdue ? 'Vencida' : 'Pendiente'}
                      </Badge>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        )}

        <Card title={`Ventas · ${rows.length}`}>
          {rows.length === 0 ? (
            <EmptyState
              title="Sin ventas en este periodo."
              hint="Las compras de Hotmart aparecen aquí en cuanto el Zap las envíe."
            />
          ) : (
            <Table head={['Fecha', 'Lead', 'Producto', 'Origen', 'Closer', 'Importe', 'Estado']}>
              {rows.map(({ sale, lead, closerName }) => (
                <tr key={sale.id} className="hover:bg-neutral-50">
                  <Td className="text-xs whitespace-nowrap">{fmtDateTime(sale.closedAt)}</Td>
                  <Td>
                    <Link href={`/owner/leads/${lead.id}`} className="font-medium hover:underline">
                      {lead.fullName}
                    </Link>
                    <div className="tnum text-xs text-neutral-500">{lead.publicId}</div>
                  </Td>
                  <Td className="max-w-xs text-xs text-neutral-600">{sale.notes ?? '—'}</Td>
                  <Td>
                    <Badge tone={sale.source === 'hotmart' ? 'info' : 'neutral'}>
                      {SOURCE[sale.source] ?? sale.source}
                    </Badge>
                  </Td>
                  {/* Una compra directa no tiene closer: se muestra vacío, no
                      se le atribuye a nadie por descarte. */}
                  <Td className="text-xs">{closerName ?? '—'}</Td>
                  <Td className="tnum font-medium">{formatMoney(sale.amountCents, sale.currency)}</Td>
                  <Td>
                    <Badge tone={SALE_STATUS[sale.status]?.tone ?? 'neutral'}>
                      {SALE_STATUS[sale.status]?.label ?? sale.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </Shell>
  );
}
