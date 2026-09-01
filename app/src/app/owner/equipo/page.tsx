import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Card, PageHeader, Table, Td, Badge, EmptyState } from '@/components/ui';
import { listUsers } from '@/domain/queries';
import { setterStats, closerStats } from '@/domain/metrics';
import { db } from '@/db';
import { userRoles } from '@/db/schema';
import { fmtPercent, fmtNumber, ratio } from '@/lib/format';
import { label, ROLE } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function Equipo({
  searchParams,
}: { searchParams: Promise<{ dias?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const days = Number(sp.dias ?? 30);
  const range = { from: new Date(Date.now() - days * 86400_000), to: new Date() };

  const [users, roles, setters, closers] = await Promise.all([
    listUsers(), db.select().from(userRoles),
    setterStats(range), closerStats(range),
  ]);

  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? '—';

  return (
    <Shell session={session} current="/owner/equipo">
      <PageHeader title="Equipo" subtitle={`Últimos ${days} días`} />

      <div className="space-y-4">
        <Card title="Personas">
          <Table head={['Nombre', 'Email', 'Roles', 'Estado']}>
            {users.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.name}</Td>
                <Td className="text-xs text-neutral-500">{u.email}</Td>
                <Td className="text-xs">
                  {roles.filter((r) => r.userId === u.id).map((r) => label(ROLE, r.roleCode)).join(' · ') || '—'}
                </Td>
                <Td>
                  <Badge tone={u.active ? 'positive' : 'neutral'}>{u.active ? 'Activo' : 'Inactivo'}</Badge>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Setters">
          {setters.length === 0 ? (
            <EmptyState title="Sin actividad de setter en el periodo." />
          ) : (
            <>
              <Table head={['Setter', 'Leads con intento', 'Intentos', 'Contactados', 'Contact rate', 'Cualificados', 'Cualificación']}>
                {setters.map((s) => (
                  <tr key={s.setterId}>
                    <Td className="font-medium">{nameOf(s.setterId)}</Td>
                    <Td className="tnum">{fmtNumber(s.leadsAttempted)}</Td>
                    <Td className="tnum">{fmtNumber(s.attempts)}</Td>
                    <Td className="tnum">{fmtNumber(s.answered)}</Td>
                    <Td className="tnum">{fmtPercent(ratio(s.answered, s.leadsAttempted))}</Td>
                    <Td className="tnum">{fmtNumber(s.qualified)}</Td>
                    <Td className="tnum">{fmtPercent(ratio(s.qualified, s.answered))}</Td>
                  </tr>
                ))}
              </Table>
              <p className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-500">
                Los ratios van siempre acompañados del volumen. Un 80 % de
                cualificación sobre 10 leads no es mejor que un 68 % sobre 140:
                es una muestra distinta, no un mejor rendimiento.
              </p>
            </>
          )}
        </Card>

        <Card title="Closers">
          {closers.length === 0 ? (
            <EmptyState title="Sin reuniones asignadas en el periodo." />
          ) : (
            <>
              <Table head={['Closer', 'Asignadas', 'Realizadas', 'No-shows', 'Show rate', 'Ventas', 'Close rate', 'Seguimientos']}>
                {closers.map((c) => (
                  <tr key={c.closerId}>
                    <Td className="font-medium">{nameOf(c.closerId)}</Td>
                    <Td className="tnum">{fmtNumber(c.assigned)}</Td>
                    <Td className="tnum">{fmtNumber(c.held)}</Td>
                    <Td className="tnum">{fmtNumber(c.noShow)}</Td>
                    <Td className="tnum">{fmtPercent(ratio(c.held, c.held + c.noShow))}</Td>
                    <Td className="tnum">{fmtNumber(c.won)}</Td>
                    <Td className="tnum">{fmtPercent(ratio(c.won, c.held))}</Td>
                    <Td className="tnum">{fmtNumber(c.followUp)}</Td>
                  </tr>
                ))}
              </Table>
              <p className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-500">
                Comparar close rates sin mirar el mix de leads asignados lleva a
                conclusiones falsas. Con menos de 10 reuniones, ninguno de estos
                números es concluyente todavía.
              </p>
            </>
          )}
        </Card>
      </div>
    </Shell>
  );
}
