import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { webhookEvents } from '@/db/schema';
import { recordExternalSale, type ExternalSaleStatus } from '@/domain/external-sales';
import { eurosToCents } from '@/lib/format';

/**
 * Facturación de Hotmart, vía Zapier.
 *
 * Zapier escucha a Hotmart y reenvía aquí. Se acepta un payload flexible
 * porque el mapeo de campos lo decides tú en el Zap, y los nombres que use
 * Hotmart pueden cambiar sin avisar. Lo único innegociable es la referencia
 * de la transacción: sin ella no hay idempotencia y una compra reenviada se
 * contabiliza dos veces.
 *
 * Configuración en Zapier — acción "Webhooks by Zapier · POST":
 *   URL      https://TU-DOMINIO/api/webhooks/hotmart
 *   Headers  x-crm-token: <HOTMART_WEBHOOK_TOKEN>
 *   Payload  JSON con los campos de abajo
 */

export const runtime = 'nodejs';

/** Se aceptan varios alias por campo: distintas versiones de la API de
 *  Hotmart y distintos mapeos de Zapier los nombran de forma distinta. */
const Body = z.object({
  transaction: z.string().optional(),
  transaction_id: z.string().optional(),
  order_id: z.string().optional(),

  status: z.string().optional(),
  purchase_status: z.string().optional(),
  event: z.string().optional(),

  buyer_name: z.string().optional(),
  name: z.string().optional(),
  buyer_email: z.string().optional(),
  email: z.string().optional(),
  buyer_phone: z.string().optional(),
  phone: z.string().optional(),

  product_name: z.string().optional(),
  product: z.string().optional(),

  // El importe puede venir como "197,00", "197.00" o 19700 (céntimos).
  price: z.union([z.string(), z.number()]).optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  value: z.union([z.string(), z.number()]).optional(),
  amount_cents: z.number().optional(),

  currency: z.string().optional(),
  currency_code: z.string().optional(),
  payment_type: z.string().optional(),
  payment_method: z.string().optional(),
  installments: z.union([z.string(), z.number()]).optional(),
  purchase_date: z.string().optional(),
  order_date: z.string().optional(),
}).passthrough();

/**
 * Vocabulario real de Hotmart, tomado de la propia integración de Zapier.
 * Los eventos llegan como `PURCHASE_APPROVED`, no como `approved`: se aceptan
 * las dos formas por si algún día cambia el mapeo del Zap.
 */
const STATUS_MAP: Record<string, ExternalSaleStatus> = {
  purchase_approved: 'approved', approved: 'approved', aprobada: 'approved',
  purchase_complete: 'complete', complete: 'complete', completed: 'complete',
  purchase_refunded: 'refunded', refunded: 'refunded', reembolsada: 'refunded',
  purchase_chargeback: 'chargeback', chargeback: 'chargeback', contracargo: 'chargeback',
  purchase_canceled: 'canceled', canceled: 'canceled', cancelled: 'canceled',
  purchase_expired: 'expired', expired: 'expired', expirada: 'expired',
};

/**
 * Eventos que se reconocen pero NO tocan la contabilidad.
 *
 *   PROTEST         una disputa abierta todavía no es dinero devuelto
 *   DELAYED         un recibo vencido no anula la venta
 *   BILLET_PRINTED  emitir un boleto no es haber cobrado
 *
 * Se acusan recibo y se registran; revertir la venta aquí sería descuadrar
 * el mes por algo que aún puede resolverse a favor.
 */
const ACKNOWLEDGED: Record<string, string> = {
  purchase_protest: 'Disputa abierta',
  purchase_delayed: 'Pago retrasado',
  purchase_billet_printed: 'Boleto emitido',
};

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-crm-token');
  if (!process.env.HOTMART_WEBHOOK_TOKEN || token !== process.env.HOTMART_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  let raw: unknown;
  try { raw = await req.json(); }
  catch { return NextResponse.json({ error: { code: 'INVALID_JSON' } }, { status: 400 }); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', details: parsed.error.flatten() } }, { status: 400 });
  }
  const b = parsed.data;

  const transactionId = b.transaction ?? b.transaction_id ?? b.order_id;
  if (!transactionId) {
    return NextResponse.json({
      error: {
        code: 'MISSING_TRANSACTION',
        message: 'Falta la referencia de la transacción. Sin ella, una compra reenviada se contaría dos veces.',
      },
    }, { status: 400 });
  }

  const rawStatus = String(b.status ?? b.purchase_status ?? b.event ?? 'approved')
    .toLowerCase().trim();

  if (ACKNOWLEDGED[rawStatus]) {
    await store(transactionId, raw, 'processed', null);
    return NextResponse.json({
      data: { ok: true, acknowledged: ACKNOWLEDGED[rawStatus], accountingChanged: false },
    });
  }

  const status = STATUS_MAP[rawStatus];
  if (!status) {
    // Estado que no conocemos: se guarda el evento y NO se toca la contabilidad.
    await store(transactionId, raw, 'failed', `Estado desconocido: ${rawStatus}`);
    return NextResponse.json({
      error: { code: 'UNKNOWN_STATUS', message: `Estado "${rawStatus}" no reconocido.` },
    }, { status: 422 });
  }

  const amountCents = toCents(b.amount_cents ?? b.price ?? b.amount ?? b.value);
  if (amountCents === null || amountCents <= 0) {
    await store(transactionId, raw, 'failed', 'Importe no interpretable');
    return NextResponse.json({
      error: { code: 'MISSING_AMOUNT', message: 'No se ha podido interpretar el importe.' },
    }, { status: 400 });
  }

  const already = await db.select().from(webhookEvents)
    .where(and(
      eq(webhookEvents.provider, 'hotmart'),
      eq(webhookEvents.externalEventId, transactionId),
    )).limit(1);
  if (already.length && already[0].status === 'processed' && status !== 'refunded' && status !== 'chargeback') {
    return NextResponse.json({ data: { ok: true, duplicate: true } });
  }

  const evt = already.length ? already[0] : await store(transactionId, raw, 'processing');

  try {
    const result = await recordExternalSale({
      transactionId,
      status,
      buyerName: (b.buyer_name ?? b.name ?? 'Comprador sin nombre').trim(),
      buyerEmail: b.buyer_email ?? b.email ?? null,
      buyerPhone: b.buyer_phone ?? b.phone ?? null,
      productName: b.product_name ?? b.product ?? null,
      amountCents,
      currency: (b.currency ?? b.currency_code ?? 'EUR').toUpperCase().slice(0, 3),
      paymentMethod: b.payment_type ?? b.payment_method ?? 'hotmart',
      installments: toInt(b.installments),
      purchasedAt: parseDate(b.purchase_date ?? b.order_date),
    });

    await db.update(webhookEvents)
      .set({ status: 'processed', processedAt: new Date() })
      .where(eq(webhookEvents.id, evt.id));

    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error('[hotmart]', message);
    // El evento no se pierde: queda en failed para revisarlo o reintentarlo.
    await db.update(webhookEvents).set({
      status: 'failed', errorMessage: message, retryCount: (evt.retryCount ?? 0) + 1,
    }).where(eq(webhookEvents.id, evt.id));
    return NextResponse.json({ error: { code: 'PROCESSING_FAILED', message } }, { status: 500 });
  }
}

async function store(externalEventId: string, payload: unknown, status: string, error?: string | null) {
  const rows = await db.insert(webhookEvents).values({
    provider: 'hotmart',
    externalEventId,
    eventType: 'purchase',
    payload: payload as Record<string, unknown>,
    status,
    errorMessage: error ?? null,
  }).onConflictDoUpdate({
    target: [webhookEvents.provider, webhookEvents.externalEventId],
    set: { status, errorMessage: error ?? null, payload: payload as Record<string, unknown> },
  }).returning();
  return rows[0];
}

/** "197,00" · "197.00" · 197 · 19700 → céntimos. */
function toCents(v: string | number | undefined): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') {
    // Un entero grande y redondo ya viene en céntimos; si no, son euros.
    return Number.isInteger(v) && v >= 1000 ? v : Math.round(v * 100);
  }
  const s = v.trim().replace(/[^\d.,-]/g, '');
  if (!s) return null;
  // Formato español: la coma es el decimal y el punto el separador de miles.
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function toInt(v: string | number | undefined): number | null {
  if (v === undefined) return null;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
