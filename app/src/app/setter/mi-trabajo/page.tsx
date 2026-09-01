import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import { Card, PageHeader, Badge, EmptyState, LinkButton, Stat } from '@/components/ui';
import { getWorkToday, getSetterSummary } from '@/domain/queries';
import { fmtTime, fmtRelative, isOverdue } from '@/lib/format';
import { formatPhone, telHref } from '@/lib/phone';
import { label, tone, TASK_TYPE, TASK_PRIORITY, INTEREST_LEVEL } from '@/lib/labels';

export const dynamic = 'force-dynamic';

/**
 * La pantalla que decide si el CRM sirve para algo.
 *
 * El setter entra y ve QUÉ hacer, CON QUIÉN y POR QUÉ, ya ordenado.
 * No hay filtros que aplicar ni decisiones que tomar sobre a quién llamar
 * primero: eso lo ha decidido el sistema.
 */
export default async function MiTrabajo() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [items, summary] = await Promise.all([
    getWorkToday(session.userId),
    getSetterSummary(session.userId),
  ]);

  return (
    <Shell session={session} current="/setter/mi-trabajo">
      <PageHeader title="Mi trabajo" subtitle={`Hola, ${session.name.split(' ')[0]}`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pendientes hoy" value={summary.pending} />
        <Stat label="Vencidas" value={summary.overdue}
          hint={summary.overdue > 0 ? 'Van primero en la lista' : undefined} />
        <Stat label="Reintentos" value={summary.retries} />
        <Stat label="Confirmaciones 24 h" value={summary.confirmations} />
      </div>

      <div className="mt-5">
        <Card title="Próximas acciones">
          {items.length === 0 ? (
            <EmptyState
              title="No tienes acciones pendientes ahora mismo."
              hint="Cuando entren leads nuevos o se acerque una reunión, aparecerán aquí solos."
            />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {items.map(({ task, lead, call }) => {
                const overdue = isOverdue(task.dueAt);
                return (
                  <li key={task.id} className="flex flex-wrap items-start gap-3 px-4 py-3 hover:bg-neutral-50">
                    <div className="w-14 shrink-0">
                      <div className={`tnum text-sm font-semibold ${overdue ? 'text-red-700' : 'text-neutral-900'}`}>
                        {task.dueAt ? fmtTime(task.dueAt) : '—'}
                      </div>
                      <div className="text-[11px] text-neutral-400">
                        {task.dueAt ? fmtRelative(task.dueAt) : ''}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-neutral-900">
                          {lead?.fullName ?? task.title}
                        </span>
                        <Badge tone={tone(TASK_TYPE, task.taskType)}>{label(TASK_TYPE, task.taskType)}</Badge>
                        {overdue && <Badge tone="negative">Vencida</Badge>}
                        {task.priority === 'critical' && !overdue && <Badge tone="negative">Crítica</Badge>}
                        {lead?.interestLevel && (
                          <Badge tone={tone(INTEREST_LEVEL, lead.interestLevel)}>
                            Interés {label(INTEREST_LEVEL, lead.interestLevel).toLowerCase()}
                          </Badge>
                        )}
                      </div>

                      {/* El motivo NO es decorativo: una tarea automática que
                          no explica por qué existe acaba ignorándose. */}
                      <p className="mt-0.5 text-xs text-neutral-600">{task.reason ?? task.description}</p>

                      {lead?.phoneNormalized && (
                        <p className="tnum mt-0.5 text-xs text-neutral-400">
                          {formatPhone(lead.phoneNormalized)}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {lead?.phoneNormalized && (
                        <a href={telHref(lead.phoneNormalized)}
                          className="inline-flex items-center rounded-md border border-neutral-900 bg-neutral-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-neutral-800">
                          Llamar
                        </a>
                      )}
                      {call ? (
                        <LinkButton size="sm" href={`/setter/llamada/${call.id}`}>Registrar</LinkButton>
                      ) : lead ? (
                        <LinkButton size="sm" href={`/owner/leads/${lead.id}`}>Ficha</LinkButton>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <p className="mt-4 text-xs text-neutral-500">
        El orden lo decide el sistema: primero lo vencido y crítico, después las
        confirmaciones de 24 h, luego los reintentos y las primeras llamadas.
      </p>
    </Shell>
  );
}
