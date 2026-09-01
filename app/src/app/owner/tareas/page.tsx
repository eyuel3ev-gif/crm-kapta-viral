import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Card, PageHeader, Table, Td, Badge, EmptyState, LinkButton } from '@/components/ui';
import { listTasks } from '@/domain/queries';
import { fmtDateTime, isOverdue } from '@/lib/format';
import { label, tone, TASK_TYPE, TASK_PRIORITY, TASK_STATUS } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const ESTADOS = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'overdue', label: 'Vencidas' },
  { key: 'completed', label: 'Completadas' },
  { key: '', label: 'Todas' },
];

const TIPOS = [
  { key: '', label: 'Todos los tipos' },
  { key: 'call_1', label: 'Llamada #1' },
  { key: 'call_1_retry', label: 'Reintentos' },
  { key: 'confirm_live', label: 'Confirmar directo' },
  { key: 'confirm_meeting_24h', label: 'Confirmación 24 h' },
  { key: 'meeting_result', label: 'Registrar resultado' },
  { key: 'follow_up', label: 'Seguimientos' },
];

export default async function Tareas({
  searchParams,
}: { searchParams: Promise<{ estado?: string; tipo?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const estado = sp.estado ?? 'pending';
  const rows = await listTasks({ status: estado || undefined, taskType: sp.tipo || undefined });

  const q = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    if (o.estado) p.set('estado', o.estado);
    if (o.tipo) p.set('tipo', o.tipo);
    const s = p.toString();
    return `/owner/tareas${s ? `?${s}` : ''}`;
  };

  return (
    <Shell session={session} current="/owner/tareas">
      <PageHeader title="Tareas" subtitle={`${rows.length} tareas`} />

      <div className="mb-2 flex flex-wrap gap-1">
        {ESTADOS.map((e) => (
          <LinkButton key={e.key} size="sm" href={q({ estado: e.key, tipo: sp.tipo })}
            variant={estado === e.key ? 'primary' : 'secondary'}>{e.label}</LinkButton>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        {TIPOS.map((t) => (
          <LinkButton key={t.key} size="sm" href={q({ estado: sp.estado, tipo: t.key })}
            variant={(sp.tipo ?? '') === t.key ? 'primary' : 'secondary'}>{t.label}</LinkButton>
        ))}
      </div>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No hay tareas con estos filtros." />
        ) : (
          <Table head={['Tarea', 'Motivo', 'Lead', 'Tipo', 'Origen', 'Responsable', 'Prioridad', 'Vence', 'Estado']}>
            {rows.map(({ task, assigneeName, lead }) => {
              const overdue = task.status !== 'completed' && isOverdue(task.dueAt);
              return (
                <tr key={task.id} className="hover:bg-neutral-50">
                  <Td className="font-medium">{task.title}</Td>
                  <Td className="max-w-xs text-xs text-neutral-600">{task.reason ?? '—'}</Td>
                  <Td className="text-xs">
                    {lead ? <Link href={`/owner/leads/${lead.id}`} className="hover:underline">{lead.fullName}</Link> : '—'}
                  </Td>
                  <Td><Badge tone={tone(TASK_TYPE, task.taskType)}>{label(TASK_TYPE, task.taskType)}</Badge></Td>
                  {/* Distinguir manual de automática: si el equipo no sabe
                      quién creó una tarea, deja de fiarse de la lista. */}
                  <Td><Badge tone={task.source === 'automation' ? 'info' : 'neutral'}>
                    {task.source === 'automation' ? 'Sistema' : 'Manual'}
                  </Badge></Td>
                  <Td className="text-xs">{assigneeName ?? '—'}</Td>
                  <Td><Badge tone={tone(TASK_PRIORITY, task.priority)}>{label(TASK_PRIORITY, task.priority)}</Badge></Td>
                  <Td className={`text-xs ${overdue ? 'font-medium text-red-700' : ''}`}>{fmtDateTime(task.dueAt)}</Td>
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
