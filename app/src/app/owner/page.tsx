import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Shell } from '@/components/shell';
import {
  Card, Stat, PageHeader, Alert, EmptyState, LinkButton, Badge,
} from '@/components/ui';
import { getKpis, getFunnel, funnelStages, biggestDropoff, needsAttention, previousRange, change } from '@/domain/metrics';
import { fmtNumber, fmtPercent, formatMoney } from '@/lib/format';
import { resolveScope } from '@/lib/scope';

export const dynamic = 'force-dynamic';

export default async function OwnerHome({
  searchParams,
}: { searchParams: Promise<{ dias?: string; modo?: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const days = Number(sp.dias ?? 30);
  const mode = (sp.modo === 'cohorte' ? 'cohort' : 'activity') as 'activity' | 'cohort';

  const scope = await resolveScope();
  const range = { from: new Date(Date.now() - days * 86400_000), to: new Date(), mode, launchIds: scope.launchIds };
  const [kpis, prev, alerts] = await Promise.all([
    getKpis(range),
    getKpis(previousRange(range)),
    needsAttention(scope.launchIds),
  ]);

  // En Evergreen el embudo no pasa por reuniones.
  const stages = funnelStages(kpis, { withMeetings: scope.mode !== 'evergreen' && kpis.meetingsBooked > 0 });
  const worst = biggestDropoff(stages);

  return (
    <Shell session={session} current="/owner">
      <PageHeader
        title="Inicio"
        subtitle={`${scope.label} · últimos ${days} días · vista ${mode === 'cohort' ? 'cohorte' : 'actividad'}`}
        actions={
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <LinkButton key={d} size="sm" href={`/owner?dias=${d}&modo=${sp.modo ?? 'actividad'}`}
                variant={d === days ? 'primary' : 'secondary'}>{d} d</LinkButton>
            ))}
          </div>
        }
      />

      {/* Actividad vs cohorte. No es un adorno: para decidir si un anuncio
          funciona hay que mirar cohorte, o un anuncio de hace dos semanas
          parece estar rindiendo hoy. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-500">Modo:</span>
        <LinkButton size="sm" href={`/owner?dias=${days}&modo=actividad`}
          variant={mode === 'activity' ? 'primary' : 'secondary'}>Actividad</LinkButton>
        <LinkButton size="sm" href={`/owner?dias=${days}&modo=cohorte`}
          variant={mode === 'cohort' ? 'primary' : 'secondary'}>Cohorte</LinkButton>
        <span className="hidden text-neutral-400 lg:inline">
          {mode === 'cohort'
            ? 'Resultados de los leads captados en el periodo, cierren cuando cierren.'
            : 'Hechos ocurridos dentro del periodo, entrara el lead cuando entrara.'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Leads" value={fmtNumber(kpis.registeredLeads)}
          delta={change(kpis.registeredLeads, prev.registeredLeads)} />
        <Stat label="Cualificados" value={fmtNumber(kpis.qualifiedLeads)}
          hint={`${fmtPercent(kpis.qualificationRateRegistered, 0)} de registrados`}
          delta={change(kpis.qualifiedLeads, prev.qualifiedLeads)} />
        <Stat label="Reuniones" value={fmtNumber(kpis.meetingsBooked)}
          hint={`${fmtNumber(kpis.meetingsHeld)} realizadas`}
          delta={change(kpis.meetingsBooked, prev.meetingsBooked)} />
        <Stat label="Ventas" value={fmtNumber(kpis.salesWon)}
          delta={change(kpis.salesWon, prev.salesWon)} />
        <Stat label="Revenue" value={formatMoney(kpis.revenueCents)}
          delta={change(kpis.revenueCents, prev.revenueCents)} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Contact rate" value={fmtPercent(kpis.contactRate)}
          hint="contactados / con intento" />
        <Stat label="Cualificación" value={fmtPercent(kpis.qualificationRateContacted)}
          hint="cualificados / contactados" />
        <Stat label="Show rate" value={fmtPercent(kpis.showRate)}
          hint="realizadas / esperadas" />
        <Stat label="Close rate" value={fmtPercent(kpis.closeRateMeetings)}
          hint="ventas / reuniones realizadas" />
        <Stat label="Ticket medio" value={formatMoney(kpis.avgTicketCents)} />
      </div>

      {kpis.sampleWarning && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {kpis.sampleWarning}
        </p>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Requiere atención">
          {alerts.length === 0 ? (
            <EmptyState title="Nada urgente ahora mismo."
              hint="Aquí aparecen los problemas que necesitan una decisión, no la actividad normal." />
          ) : (
            <div className="divide-y divide-neutral-100">
              {alerts.map((a) => (
                <Alert key={a.code} href={a.href} title={a.title}
                  tone={a.severity === 'critical' ? 'negative' : a.severity === 'warning' ? 'warning' : 'info'}>
                  {a.explanation}
                </Alert>
              ))}
            </div>
          )}
        </Card>

        <Card title="Embudo">
          <div className="px-4 py-3">
            {stages.map((s, i) => {
              const max = stages[0].value || 1;
              const width = Math.max(2, (s.value / max) * 100);
              const isWorst = worst?.key === s.key;
              return (
                <div key={s.key} className="mb-2.5 last:mb-0">
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="font-medium text-neutral-700">
                      {s.label}
                      {isWorst && <Badge tone="negative" className="ml-2">mayor caída</Badge>}
                    </span>
                    <span className="tnum text-neutral-500">
                      {fmtNumber(s.value)}
                      {i > 0 && s.convFromPrev !== null && (
                        <span className="ml-2 text-neutral-400">{fmtPercent(s.convFromPrev, 0)}</span>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <div className={isWorst ? 'h-full bg-red-500' : 'h-full bg-neutral-800'}
                      style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
            {worst && (
              <p className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
                La mayor pérdida de volumen está en <strong>{worst.label}</strong>. No es
                necesariamente la etapa con peor porcentaje: es donde más gente se cae en
                términos absolutos, que es lo que se puede recuperar.
              </p>
            )}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
