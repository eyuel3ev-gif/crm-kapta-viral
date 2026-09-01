import { NextRequest, NextResponse } from 'next/server';
import { runAllRules } from '@/domain/automation';

/**
 * Motor de reglas.
 *
 * Lo llama Vercel Cron (o Inngest) cada 5–10 minutos. Todas las reglas son
 * idempotentes, así que ejecutarlo 300 veces al día produce exactamente las
 * mismas tareas que ejecutarlo una: la protección está en el `dedupe_key`,
 * no en la frecuencia del cron.
 *
 * vercel.json:
 *   { "crons": [{ "path": "/api/cron", "schedule": "*\/10 * * * *" }] }
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  const started = Date.now();
  const results = await runAllRules();

  return NextResponse.json({
    data: {
      results,
      created: results.reduce((n, r) => n + r.created, 0),
      skipped: results.reduce((n, r) => n + r.skipped, 0),
      ms: Date.now() - started,
    },
  });
}
