'use client';

import { useActionState, useState } from 'react';
import {
  actionMeetingResult, actionSaveMeetingDraft, type ActionState,
} from '@/app/actions';
import { Button, Card, Field, Input, Select, Textarea, Badge } from '@/components/ui';

const initial: ActionState = { ok: true };

type LossReason = { code: string; label: string };

export function ResultForm({
  meetingId, lossReasons, defaults,
}: {
  meetingId: string;
  lossReasons: LossReason[];
  defaults: { notes: string | null; phantomUrl: string | null };
}) {
  const [state, submit, pending] = useActionState(actionMeetingResult, initial);
  const [draftState, saveDraft, draftPending] = useActionState(actionSaveMeetingDraft, initial);

  const [result, setResult] = useState('');
  const [financed, setFinanced] = useState(false);

  return (
    <div className="space-y-4">
      {state.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </div>
      )}

      {/* Guardado independiente del resultado. El closer anota durante la
          llamada y puede cerrar la pestaña antes de decidir qué marcar. */}
      <form action={saveDraft}>
        <input type="hidden" name="meetingId" value={meetingId} />
        <Card
          title="Notas y grabación"
          action={
            <div className="flex items-center gap-2">
              {draftState.ok && !draftPending && draftState.error === undefined && (
                <span className="text-xs text-green-700">Guardado</span>
              )}
              <Button size="sm" type="submit" disabled={draftPending}>
                {draftPending ? 'Guardando…' : 'Guardar borrador'}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 px-4 py-3">
            <Field label="Notas del closer" hint="Lo que no cabe en los campos de arriba: qué frenó, qué convenció.">
              <Textarea name="notes" rows={3} defaultValue={defaults.notes ?? ''}
                placeholder="Buen fit. Dolor fuerte por falta de estructura. La objeción real fue timing, no precio." />
            </Field>

            <Field label="Link de grabación / Phantom"
              hint="Que falte no impide guardar la reunión.">
              <Input name="phantomUrl" type="url" defaultValue={defaults.phantomUrl ?? ''}
                placeholder="https://…" />
            </Field>

          </div>
        </Card>
      </form>

      <form action={submit} className="space-y-4">
        <input type="hidden" name="meetingId" value={meetingId} />

        <Card title="Resultado de la reunión">
          <div className="space-y-3 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              {[
                { v: 'won', l: 'Ganado', c: 'success' },
                { v: 'follow_up', l: 'Seguimiento', c: 'warning' },
                { v: 'lost', l: 'Perdido', c: 'danger' },
                { v: 'no_show', l: 'No-show', c: 'secondary' },
              ].map((o) => (
                <label key={o.v} className="cursor-pointer">
                  <input type="radio" name="result" value={o.v} className="peer sr-only"
                    onChange={() => setResult(o.v)} required />
                  <span className="inline-flex rounded-md border border-neutral-300 px-3 py-1.5 text-sm
                    peer-checked:border-neutral-900 peer-checked:bg-neutral-900 peer-checked:text-white">
                    {o.l}
                  </span>
                </label>
              ))}
            </div>

            {result === 'no_show' && (
              <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                Un no-show no marca el lead como perdido. Se crea una tarea para
                intentar reagendar.
              </p>
            )}

            {/* ── GANADO ─────────────────────────────────────────────── */}
            {result === 'won' && (
              <div className="space-y-3 rounded-md border border-green-200 bg-green-50/50 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Importe (€)" required>
                    <Input name="amount" type="number" step="0.01" min="1" defaultValue="3000" />
                  </Field>
                  <Field label="Método de pago" required>
                    <Select name="paymentMethod" defaultValue=""
                      onChange={(e) => setFinanced(e.target.value === 'financing')}>
                      <option value="">Selecciona…</option>
                      <option value="card">Tarjeta</option>
                      <option value="transfer">Transferencia</option>
                      <option value="financing">Financiación</option>
                      <option value="other">Otro</option>
                    </Select>
                  </Field>
                </div>

                {financed && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {/* Estado explícito, no un booleano: "solicitada" y
                        "rechazada" son situaciones muy distintas. */}
                    <Field label="Estado de la financiación" required>
                      <Select name="financingStatus" defaultValue="requested">
                        <option value="requested">Solicitada</option>
                        <option value="approved">Aprobada</option>
                        <option value="pending">Pendiente</option>
                        <option value="rejected">Rechazada</option>
                      </Select>
                    </Field>
                    <Field label="Proveedor">
                      <Input name="financingProvider" placeholder="Sequra, Aplazame…" />
                    </Field>
                    <Field label="Nº de cuotas" hint="Genera el calendario de cobros.">
                      <Input name="installments" type="number" min="1" max="24" defaultValue="3" />
                    </Field>
                  </div>
                )}
              </div>
            )}

            {/* ── PERDIDO ────────────────────────────────────────────── */}
            {result === 'lost' && (
              <div className="space-y-3 rounded-md border border-red-200 bg-red-50/50 p-3">
                <Field label="Motivo de pérdida" required
                  hint="Del catálogo, no texto libre: es lo que hace posible analizar después por qué se pierde.">
                  <Select name="lossReasonCode" defaultValue="">
                    <option value="">Selecciona…</option>
                    {lossReasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </Select>
                </Field>
                <Field label="Detalle">
                  <Textarea name="lossReasonNotes" rows={2} />
                </Field>
              </div>
            )}

            {/* ── SEGUIMIENTO ────────────────────────────────────────── */}
            {result === 'follow_up' && (
              <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/50 p-3">
                <p className="text-xs text-amber-900">
                  Un seguimiento sin fecha ni próxima acción es un lead olvidado
                  con otro nombre. Los tres campos son obligatorios.
                </p>
                <Field label="Motivo del seguimiento" required>
                  <Input name="followUpReason"
                    placeholder="Necesita revisar la financiación con su pareja" />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Fecha y hora siguiente" required>
                    <Input name="followUpAt" type="datetime-local" />
                  </Field>
                  <Field label="Próxima acción" required>
                    <Input name="nextAction" placeholder="Llamada de seguimiento" />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="createSecondMeeting" className="rounded border-neutral-300" />
                  <span>Crear la siguiente reunión en esa fecha</span>
                  <span className="text-xs text-neutral-500">
                    (la reunión actual no se toca: conserva sus notas y su transcripción)
                  </span>
                </label>
              </div>
            )}
          </div>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-neutral-500">
            Guardar el resultado cierra la reunión y actualiza las métricas.
          </span>
          <Button type="submit" variant="primary" disabled={pending || !result}>
            {pending ? 'Guardando…' : 'Guardar resultado'}
          </Button>
        </div>
      </form>
    </div>
  );
}
