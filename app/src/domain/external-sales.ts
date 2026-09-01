import { and, eq, sql, desc } from 'drizzle-orm';
import { db } from '@/db';
import { leads, sales, payments, launches } from '@/db/schema';
import { createLeadFromForm, findExistingLead } from './leads';
import { emit, logActivity, logAudit } from './events';
import { applyAutomaticStatus, type LeadStatus } from './state';

/**
 * Ventas que NO nacen en el CRM.
 *
 * Hotmart cobra; el CRM se entera después. Eso invierte la fuente de verdad:
 * para una compra directa, el importe y el estado del pago los manda Hotmart,
 * no el closer. El CRM sigue siendo dueño del estado comercial del lead.
 *
 * Una compra directa no tiene reunión ni closer, y por eso `sales.meeting_id`
 * y `sales.closer_id` son nullables. Inventar una reunión fantasma para poder
 * guardar la venta destrozaría el show rate y el close rate.
 */

export type ExternalSaleStatus =
  | 'approved' | 'complete' | 'refunded' | 'chargeback' | 'canceled' | 'expired';

export type ExternalSaleInput = {
  transactionId: string;
  status: ExternalSaleStatus;
  buyerName: string;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  productName?: string | null;
  amountCents: number;
  currency?: string;
  paymentMethod?: string | null;
  installments?: number | null;
  purchasedAt?: Date | null;
};

export type ExternalSaleResult = {
  saleId: string | null;
  leadId: string;
  publicId: string;
  action: 'created' | 'updated' | 'ignored_duplicate' | 'reverted';
};

const REVERSALS: ExternalSaleStatus[] = ['refunded', 'chargeback', 'canceled', 'expired'];

export async function recordExternalSale(
  input: ExternalSaleInput,
  provider = 'hotmart',
): Promise<ExternalSaleResult> {
  /* ── Fase 1, FUERA de la transacción ─────────────────────────────────
   * Resolver el lead puede implicar crearlo, y crear un lead abre su propia
   * transacción. Anidar transacciones bloquea la conexión: hacerlo dentro
   * convertía este webhook en una espera de tres minutos.
   */
  const preexisting = await db.select().from(sales)
    .where(and(eq(sales.source, provider), eq(sales.externalId, input.transactionId)))
    .limit(1);

  let resolvedLeadId: string | null = null;

  if (!preexisting.length && !REVERSALS.includes(input.status)) {
    // Se busca al comprador entre los leads que ya trabajamos: si compró tras
    // una reunión, la venta tiene que colgar de SU ficha, no de una nueva.
    const match = await findExistingLead(db, {
      phone: input.buyerPhone, email: input.buyerEmail, name: input.buyerName,
    });

    if (match.kind === 'exact') {
      resolvedLeadId = match.leadId;
    } else {
      const created = await createLeadFromForm({
        fullName: input.buyerName,
        phone: input.buyerPhone ?? null,
        email: input.buyerEmail ?? null,
        source: provider,
        channel: 'manual',
        launchType: 'evergreen',   // una compra directa sin lead previo es Evergreen
        idempotencyKey: `${provider}:${input.transactionId}`,
      });
      resolvedLeadId = created.leadId;
    }
  }

  /* ── Fase 2, dentro de la transacción ────────────────────────────────── */
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(sales)
      .where(and(eq(sales.source, provider), eq(sales.externalId, input.transactionId)))
      .limit(1);

    /* ── Reembolso o devolución ────────────────────────────────────────
     * No se borra la venta: se marca. Borrarla dejaría un mes cerrado que
     * ya no cuadra con lo que se cobró, y sin rastro de por qué. */
    if (REVERSALS.includes(input.status)) {
      if (!existing.length) {
        // Llega la devolución de una compra que nunca vimos. Se ignora, pero
        // el webhook queda registrado para poder investigarlo.
        throw new Error(`UNKNOWN_TRANSACTION: ${input.transactionId} no existe en el CRM`);
      }
      const sale = existing[0];
      const newStatus = input.status === 'chargeback' ? 'defaulted' : 'refunded';

      await tx.update(sales).set({ status: newStatus, updatedAt: new Date() })
        .where(eq(sales.id, sale.id));
      await tx.update(payments).set({ status: 'refunded' })
        .where(eq(payments.saleId, sale.id));

      await recalcLeadRevenue(tx, sale.leadId);

      const lead = await tx.select().from(leads).where(eq(leads.id, sale.leadId)).limit(1);
      await tx.update(leads).set({
        status: (lead[0]?.revenueCents ?? 0) > 0 ? 'won' : 'lost',
        updatedAt: new Date(),
      }).where(eq(leads.id, sale.leadId));

      await logActivity(tx, {
        leadId: sale.leadId, eventType: 'SALE_REVERSED',
        title: input.status === 'chargeback' ? 'Contracargo' : 'Reembolso',
        description: `${provider} · ${input.transactionId}`,
        actorType: 'integration',
      });
      await logAudit(tx, {
        actorType: 'integration', action: 'sale.reversed',
        entityType: 'sale', entityId: sale.id,
        oldValues: { status: sale.status }, newValues: { status: newStatus },
      });
      await emit(tx, {
        eventType: 'sale.corrected', entityType: 'sale', entityId: sale.id,
        leadId: sale.leadId, actorType: 'integration', payload: { status: input.status },
      });

      const l = await tx.select().from(leads).where(eq(leads.id, sale.leadId)).limit(1);
      return { saleId: sale.id, leadId: sale.leadId, publicId: l[0].publicId, action: 'reverted' };
    }

    /* ── Compra aprobada ───────────────────────────────────────────────── */
    if (existing.length) {
      const l = await tx.select().from(leads).where(eq(leads.id, existing[0].leadId)).limit(1);
      return {
        saleId: existing[0].id, leadId: existing[0].leadId,
        publicId: l[0].publicId, action: 'ignored_duplicate',
      };
    }


    if (!resolvedLeadId) throw new Error('LEAD_UNRESOLVED');
    const leadId = resolvedLeadId;
    const leadRow = await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    const publicId = leadRow[0].publicId;

    const closedAt = input.purchasedAt ?? new Date();
    const lead = await tx.select().from(leads).where(eq(leads.id, leadId)).limit(1);

    const inserted = await tx.insert(sales).values({
      leadId,
      meetingId: null,          // una compra directa no pasa por reunión
      closerId: lead[0].assignedCloserId ?? null,
      // La venta cuelga del MISMO negocio que el lead: si compró tras una
      // reunión del lanzamiento, no puede contabilizarse como Evergreen.
      launchId: lead[0].launchId,
      source: provider,
      externalId: input.transactionId,
      amountCents: input.amountCents,
      currency: input.currency ?? 'EUR',
      paymentMethod: input.paymentMethod ?? 'hotmart',
      installments: input.installments ?? null,
      installmentCents: input.installments && input.installments > 1
        ? Math.round(input.amountCents / input.installments) : null,
      closedAt,
      idempotencyKey: `${provider}:${input.transactionId}`,
      notes: input.productName ?? null,
    }).onConflictDoNothing({ target: sales.idempotencyKey }).returning({ id: sales.id });

    if (!inserted.length) {
      return { saleId: null, leadId, publicId, action: 'ignored_duplicate' };
    }

    // Cobro. Hotmart confirma que el dinero entró, así que nace pagado.
    await tx.insert(payments).values({
      saleId: inserted[0].id,
      amountCents: input.installments && input.installments > 1
        ? Math.round(input.amountCents / input.installments) : input.amountCents,
      currency: input.currency ?? 'EUR',
      status: 'paid',
      paidAt: closedAt,
      installmentNumber: 1,
      externalRef: input.transactionId,
    });

    await recalcLeadRevenue(tx, leadId);

    await tx.update(leads).set({
      status: applyAutomaticStatus(lead[0].status as LeadStatus, 'won'),
      wonAt: lead[0].wonAt ?? closedAt,
      nextActionType: null, nextActionAt: null,
      updatedAt: new Date(),
    }).where(eq(leads.id, leadId));

    await logActivity(tx, {
      leadId, eventType: 'SALE_CREATED',
      title: `Compra en ${provider}`,
      description: `${(input.amountCents / 100).toFixed(2)} ${input.currency ?? 'EUR'}` +
        (input.productName ? ` · ${input.productName}` : ''),
      actorType: 'integration',
      occurredAt: closedAt,
    });
    await emit(tx, {
      eventType: 'sale.won', entityType: 'sale', entityId: inserted[0].id,
      leadId, actorType: 'integration',
      payload: { amountCents: input.amountCents, provider },
    });

    return { saleId: inserted[0].id, leadId, publicId, action: 'created' };
  });
}

/** El revenue del lead siempre se recalcula desde SALES, nunca se acumula. */
async function recalcLeadRevenue(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0], leadId: string,
) {
  const total = await tx.select({ sum: sql<number>`coalesce(sum(${sales.amountCents}), 0)` })
    .from(sales).where(and(eq(sales.leadId, leadId), eq(sales.status, 'active')));
  await tx.update(leads).set({ revenueCents: Number(total[0].sum) })
    .where(eq(leads.id, leadId));
}
