import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createLeadFromForm } from '@/domain/leads';

/**
 * Endpoint público del formulario de la landing.
 *
 * Es la única puerta abierta a internet y crea entidades comerciales, así que
 * lleva cuatro defensas. Sin ellas, un bot ensucia el CPL y llena la cola del
 * setter de basura:
 *
 *   1. Token compartido en cabecera.
 *   2. Rate limit por IP.
 *   3. Honeypot (campo invisible que solo rellenan los bots).
 *   4. Idempotencia: el mismo envío dos veces = un solo lead.
 */

export const runtime = 'nodejs';

const Body = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(6).max(30).optional().nullable(),
  email: z.string().max(160).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  form: z.enum(['REGISTRATION', 'PRECLASS_PROFILE']).default('REGISTRATION'),
  answers: z.record(z.string()).optional(),
  attribution: z.unknown().optional(),
  // Honeypot: invisible en el formulario. Si viene relleno, es un bot.
  website: z.string().optional(),
}).refine((b) => b.phone || b.email, {
  message: 'Hace falta al menos teléfono o email',
});

const hits = new Map<string, { n: number; reset: number }>();
const LIMIT = 10;
const WINDOW = 60_000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || rec.reset < now) { hits.set(ip, { n: 1, reset: now + WINDOW }); return false; }
  rec.n += 1;
  return rec.n > LIMIT;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-crm-token');
  if (!process.env.PUBLIC_FORM_TOKEN || token !== process.env.PUBLIC_FORM_TOKEN) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (rateLimited(ip)) {
    return NextResponse.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 });
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: { code: 'INVALID_JSON' } }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', details: parsed.error.flatten() } }, { status: 400 },
    );
  }
  const body = parsed.data;

  // Honeypot relleno: se responde 200 para que el bot no sepa que le hemos
  // detectado, pero no se crea nada.
  if (body.website) return NextResponse.json({ data: { ok: true } });

  // Idempotencia: si la landing reintenta el POST porque se cayó la conexión,
  // no aparecen dos veces la misma persona.
  const idempotencyKey =
    req.headers.get('idempotency-key') ??
    createHash('sha256')
      .update(`${body.form}:${body.phone ?? ''}:${body.email ?? ''}:${new Date().toISOString().slice(0, 13)}`)
      .digest('hex');

  try {
    const attribution = normalizeAttribution(body.attribution);

    const result = await createLeadFromForm({
      fullName: body.name,
      phone: body.phone ?? null,
      email: body.email ?? null,
      city: body.city ?? null,
      attribution,
      answers: body.answers,
      formCode: body.form,
      idempotencyKey,
    });

    return NextResponse.json({
      data: {
        lead_id: result.publicId,
        created: result.created,
        // La landing redirige aquí para que el formulario de perfil sepa
        // quién lo rellena, sin volver a hacer matching por nombre.
        profile_url: result.profileToken
          ? `/perfil/${result.profileToken}`
          : null,
      },
    }, { status: result.created ? 201 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[public/lead]', msg);
    if (msg.startsWith('NO_ACTIVE_LAUNCH')) {
      return NextResponse.json({ error: { code: 'NO_ACTIVE_LAUNCH' } }, { status: 503 });
    }
    return NextResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 });
  }
}

/** La landing envía `attribution` como string JSON o como objeto. */
function normalizeAttribution(input: unknown) {
  if (!input) return null;
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch { return null; }
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const a = obj as Record<string, unknown>;
  return {
    first_touch: (a.first_touch ?? a) as Record<string, never>,
    last_touch: (a.last_touch ?? undefined) as Record<string, never> | undefined,
  };
}
