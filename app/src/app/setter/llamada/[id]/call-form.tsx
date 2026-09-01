'use client';

import { useActionState, useState } from 'react';
import { actionCompleteCall, actionNoAnswer, type ActionState } from '@/app/actions';
import { Button, Field, Input, Select, Textarea, Card } from '@/components/ui';

const initial: ActionState = { ok: true };

type Question = { id: string; code: string; questionText: string; required: boolean };

export function CallForm({
  callId, callType, questions,
}: { callId: string; callType: string; questions: Question[] }) {
  const [state, submit, pending] = useActionState(actionCompleteCall, initial);
  const [noAnswerState, submitNoAnswer, noAnswerPending] = useActionState(actionNoAnswer, initial);
  const [qualification, setQualification] = useState('');

  const error = state.error ?? noAnswerState.error;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* "No coge" es una acción atómica: guarda el intento, escribe el
          historial y programa el reintento. El setter no crea nada a mano. */}
      <form action={submitNoAnswer}>
        <input type="hidden" name="callId" value={callId} />
        <Card>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-medium">¿No contesta?</p>
              <p className="text-xs text-neutral-500">
                Se guarda el intento y se programa el reintento automáticamente.
                No descalifica al lead.
              </p>
            </div>
            <Button type="submit" variant="warning" disabled={noAnswerPending}>
              {noAnswerPending ? 'Guardando…' : 'No contesta'}
            </Button>
          </div>
        </Card>
      </form>

      <form action={submit} className="space-y-4">
        <input type="hidden" name="callId" value={callId} />

        <Card title="Preguntas de la llamada">
          <div className="space-y-3 px-4 py-3">
            {questions.map((q) => (
              <Field key={q.id} label={q.questionText} required={q.required}>
                <Textarea name={`q_${q.code}`} rows={2} />
              </Field>
            ))}
          </div>
        </Card>

        <Card title="Resultado">
          <div className="space-y-3 px-4 py-3">
            {callType === 'post_class_1' && (
              <>
                <Field label="Nivel de interés" required>
                  <Select name="interestLevel" defaultValue="">
                    <option value="">Selecciona…</option>
                    <option value="low">Bajo</option>
                    <option value="medium">Medio</option>
                    <option value="high">Alto</option>
                    <option value="very_high">Muy alto</option>
                  </Select>
                </Field>

                <Field label="¿Cualificado?" required>
                  <Select name="qualification" value={qualification}
                    onChange={(e) => setQualification(e.target.value)}>
                    <option value="">Selecciona…</option>
                    <option value="qualified">Sí, cualificado</option>
                    <option value="disqualified">No cualificado</option>
                  </Select>
                </Field>

                {qualification === 'disqualified' && (
                  <Field label="Motivo" required
                    hint="Descalificar sin motivo hace imposible saber después si el problema era el tráfico o el criterio.">
                    <Select name="disqualificationReason" defaultValue="">
                      <option value="">Selecciona…</option>
                      <option value="Sin interés real">Sin interés real</option>
                      <option value="Sin tiempo / capacidad de ejecución">Sin tiempo o capacidad de ejecución</option>
                      <option value="Busca solo información gratuita">Busca solo información gratuita</option>
                      <option value="Perfil no encaja">Perfil no encaja</option>
                      <option value="Objetivo incompatible">Objetivo incompatible</option>
                      <option value="No quiere implementar">No quiere implementar</option>
                      <option value="Otro">Otro</option>
                    </Select>
                  </Field>
                )}

                {qualification === 'qualified' && (
                  <Field label="Próxima acción" hint="Un lead cualificado sin próxima acción se enfría solo.">
                    <Input name="nextAction" placeholder="Confirmar directo" defaultValue="Confirmar directo" />
                  </Field>
                )}
              </>
            )}

            {callType === 'webinar_confirmation' && (
              <Field label="¿Podrá conectarse al directo?" required
                hint="Esto es lo que dice el lead, no prueba de asistencia. La asistencia real se queda sin dato.">
                <Select name="attendanceIntent" defaultValue="">
                  <option value="">Selecciona…</option>
                  <option value="confirmed">Confirmado</option>
                  <option value="likely">Probablemente sí</option>
                  <option value="unsure">Dudoso</option>
                  <option value="cannot_attend">No puede</option>
                </Select>
              </Field>
            )}

            {callType === 'meeting_24h' && (
              <Field label="¿Confirma la reunión?" required>
                <Select name="meetingConfirmation" defaultValue="">
                  <option value="">Selecciona…</option>
                  <option value="confirmed">Confirmada</option>
                  <option value="reschedule_requested">Pide reagendar</option>
                  <option value="cancelled">Cancela</option>
                  <option value="uncertain">Dudoso</option>
                </Select>
              </Field>
            )}

            <Field label="Notas"
              hint="Solo lo que no cabe en los campos de arriba. “Buena llamada” no ayuda a nadie.">
              <Textarea name="notes" rows={3}
                placeholder="Trabaja en hostelería con turnos rotativos. Puede dedicar mañanas. Su pareja no interviene en la decisión." />
            </Field>
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <Button type="submit" variant="success" disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar llamada'}
          </Button>
        </div>
      </form>
    </div>
  );
}
