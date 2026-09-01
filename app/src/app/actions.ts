'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { requireSession } from '@/lib/auth';
import { assertCan } from '@/lib/permissions';
import { eurosToCents } from '@/lib/format';
import { completeCall, registerNoAnswer } from '@/domain/setter-calls';
import { saveMeetingResult } from '@/domain/meetings';
import { completeTask, createManualTask } from '@/domain/tasks';
import { runAllRules } from '@/domain/automation';

/**
 * Todas las server actions empiezan comprobando permisos EN EL SERVIDOR.
 * La navegación por rol es para que la interfaz sea usable; esto es lo que
 * de verdad impide que alguien con la URL haga algo que no le toca.
 */

export type ActionState = { ok: boolean; error?: string };

function fail(err: unknown): ActionState {
  const msg = err instanceof Error ? err.message : 'Error inesperado';
  // Los códigos del dominio vienen como CODIGO: mensaje legible.
  const clean = msg.includes(':') ? msg.split(':').slice(1).join(':').trim() : msg;
  return { ok: false, error: clean || msg };
}

/* ── Llamadas del setter ─────────────────────────────────────────────── */

export async function actionCompleteCall(
  _prev: ActionState, formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session, 'setter_call.manage_assigned');

    const callId = String(formData.get('callId'));
    const answers: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      if (k.startsWith('q_')) answers[k.slice(2)] = String(v);
    }

    await completeCall({
      callId,
      userId: session.userId,
      answers,
      notes: str(formData.get('notes')),
      interestLevel: str(formData.get('interestLevel')) as never,
      qualification: str(formData.get('qualification')) as never,
      disqualificationReason: str(formData.get('disqualificationReason')),
      nextAction: str(formData.get('nextAction')),
      attendanceIntent: str(formData.get('attendanceIntent')) as never,
      meetingConfirmation: str(formData.get('meetingConfirmation')) as never,
    });

    revalidatePath('/setter/mi-trabajo');
    revalidatePath('/owner');
  } catch (err) {
    return fail(err);
  }
  redirect('/setter/mi-trabajo');
}

export async function actionNoAnswer(
  _prev: ActionState, formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session, 'setter_call.manage_assigned');
    await registerNoAnswer({ callId: String(formData.get('callId')), userId: session.userId });
    revalidatePath('/setter/mi-trabajo');
  } catch (err) {
    return fail(err);
  }
  redirect('/setter/mi-trabajo');
}

/* ── Resultado de reunión ────────────────────────────────────────────── */

export async function actionMeetingResult(
  _prev: ActionState, formData: FormData,
): Promise<ActionState> {
  const meetingId = String(formData.get('meetingId'));
  try {
    const session = await requireSession();
    assertCan(session, 'meeting.result');

    const result = String(formData.get('result')) as 'won' | 'lost' | 'follow_up' | 'no_show';
    const amount = str(formData.get('amount'));
    const followUpAt = str(formData.get('followUpAt'));

    await saveMeetingResult({
      meetingId,
      userId: session.userId,
      result,
      notes: str(formData.get('notes')),
      phantomUrl: str(formData.get('phantomUrl')),
      amountCents: amount ? eurosToCents(amount) : undefined,
      paymentMethod: str(formData.get('paymentMethod')) ?? undefined,
      financingStatus: str(formData.get('financingStatus')) ?? undefined,
      financingProvider: str(formData.get('financingProvider')),
      installments: numOrNull(formData.get('installments')),
      lossReasonCode: str(formData.get('lossReasonCode')) ?? undefined,
      lossReasonNotes: str(formData.get('lossReasonNotes')),
      followUpReason: str(formData.get('followUpReason')) ?? undefined,
      followUpAt: followUpAt ? new Date(followUpAt) : undefined,
      nextAction: str(formData.get('nextAction')) ?? undefined,
      createSecondMeeting: formData.get('createSecondMeeting') === 'on',
    });

    revalidatePath('/closer/reuniones');
    revalidatePath('/owner');
  } catch (err) {
    return fail(err);
  }
  redirect('/closer/reuniones');
}

/**
 * Guardado parcial de la reunión: notas y enlace de grabación, sin exigir
 * resultado. El closer puede anotar durante la llamada y cerrar la pestaña;
 * esto tiene que persistir por su cuenta.
 */
export async function actionSaveMeetingDraft(
  _prev: ActionState, formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session, 'meeting.manage_assigned');

    const { meetings } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const meetingId = String(formData.get('meetingId'));

    await db.transaction(async (tx) => {
      await tx.update(meetings).set({
        notes: str(formData.get('notes')),
        phantomUrl: str(formData.get('phantomUrl')),
        updatedAt: new Date(),
      }).where(eq(meetings.id, meetingId));

    });

    revalidatePath(`/closer/reunion/${meetingId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ── Tareas ──────────────────────────────────────────────────────────── */

export async function actionCompleteTask(
  _prev: ActionState, formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session, 'task.manage_assigned');
    await db.transaction(async (tx) => {
      await completeTask(tx, String(formData.get('taskId')), session.userId, 'manual');
    });
    revalidatePath('/setter/mi-trabajo');
    revalidatePath('/owner/tareas');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function actionCreateTask(
  _prev: ActionState, formData: FormData,
): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session, 'task.manage_assigned');
    const due = str(formData.get('dueAt'));
    await db.transaction(async (tx) => {
      await createManualTask(tx, {
        title: String(formData.get('title')),
        description: str(formData.get('description')),
        priority: (str(formData.get('priority')) ?? 'medium') as never,
        assigneeId: str(formData.get('assigneeId')) ?? session.userId,
        createdById: session.userId,
        dueAt: due ? new Date(due) : null,
        relatedLeadId: str(formData.get('leadId')),
      });
    });
    revalidatePath('/owner/tareas');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ── Automatizaciones ────────────────────────────────────────────────── */

/** Dispara el motor de reglas a mano. En producción lo llama el cron. */
export async function actionRunAutomations(): Promise<ActionState> {
  try {
    const session = await requireSession();
    assertCan(session, 'settings.manage');
    await runAllRules();
    revalidatePath('/owner');
    revalidatePath('/setter/mi-trabajo');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ── Utilidades ──────────────────────────────────────────────────────── */

function str(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function numOrNull(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
