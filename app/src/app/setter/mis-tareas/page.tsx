import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Card, PageHeader, Table, Td, Badge, EmptyState, LinkButton } from '@/components/ui';
import { listTasks } from '@/domain/queries';
import { fmtDateTime, isOverdue } from '@/lib/format';
import { label, tone, TASK_TYPE, TASK_PRIORITY, TASK_STATUS } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'overdue', label: 'Vencidas' },
  { key: 'completed', label: 'Completadas' },
  { key: '', label: 'Todas' },
];

export default async function MisTareas({
  searchParams,
}: { searchParams: Promise<{ estado?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const estado = sp.estado ?? 'pending';
  const rows = await listTasks({ assigneeId: session.userId, status: estado || undefined });

  return (
    <Shell session={session} current="/setter/mis-tareas">
      <PageHeader title="Mis tareas" subtitle={`${rows.length} tareas`} />

      <div className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <LinkButton key={f.key} size="sm"
            href={`/setter/mis-tareas${f.key ? `?estado=${f.key}` : '?estado='}`}
            variant={estado === f.key ? 'primary' : 'secondary'}>{f.label}</LinkButton>
        ))}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No hay tareas con este filtro." />
        ) : (
          <Table head={['Tarea', 'Motivo', 'Lead', 'Tipo', 'Prioridad', 'Vence', 'Estado']}>
            {rows.map(({ task, lead }) => {
              const overdue = task.status !== 'completed' && isOverdue(task.dueAt);
              return (
                <tr key={task.id} className="hover:bg-neutral-50">
                  <Td className="font-medium">{task.title}</Td>
                  {/* Motivo en columna propia: es lo que hace accionable una
                      tarea automática frente a un simple recordatorio. */}
                  <Td className="max-w-xs text-xs text-neutral-600">{task.reason ?? '—'}</Td>
                  <Td className="text-xs">
                    {lead ? <Link href={`/owner/leads/${lead.id}`} className="hover:underline">{lead.fullName}</Link> : '—'}
                  </Td>
                  <Td><Badge tone={tone(TASK_TYPE, task.taskType)}>{label(TASK_TYPE, task.taskType)}</Badge></Td>
                  <Td><Badge tone={tone(TASK_PRIORITY, task.priority)}>{label(TASK_PRIORITY, task.priority)}</Badge></Td>
                  <Td className={`text-xs ${overdue ? 'font-medium text-red-700' : ''}`}>
                    {fmtDateTime(task.dueAt)}
                  </Td>
                  <Td>
                    {overdue
                      ? <Badge tone="negative">Vencida</Badge>
                      : <Badge tone={tone(TASK_STATUS, task.status)}>{label(TASK_STATUS, task.status)}</Badge>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </Shell>
  );
}
