import { formatInTimeZone } from 'date-fns-tz';
import { es } from 'date-fns/locale';

/** Todo se guarda en UTC y se muestra aquí. Un solo sitio para cambiarlo. */
export const TZ = 'Europe/Madrid';

/* ── Dinero ──────────────────────────────────────────────────────────────
 * Céntimos enteros, siempre. Nunca float: 0.1 + 0.2 !== 0.3 y eso, en una
 * columna de revenue, acaba en un descuadre que nadie sabe explicar.
 */

export function formatMoney(cents: number | null | undefined, currency = 'EUR'): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function eurosToCents(euros: number | string): number {
  const n = typeof euros === 'string' ? parseFloat(euros.replace(',', '.')) : euros;
  if (!Number.isFinite(n)) throw new Error('Importe no válido');
  return Math.round(n * 100);
}

/* ── Fechas ───────────────────────────────────────────────────────────── */

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return formatInTimeZone(new Date(d), TZ, "d MMM yyyy", { locale: es });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return formatInTimeZone(new Date(d), TZ, "d MMM · HH:mm", { locale: es });
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return formatInTimeZone(new Date(d), TZ, 'HH:mm', { locale: es });
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const diff = new Date(d).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const unit = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

  let label: string;
  if (mins < 1) label = 'ahora';
  else if (mins < 60) label = unit(mins, 'minuto', 'minutos');
  else if (mins < 1440) label = unit(Math.round(mins / 60), 'hora', 'horas');
  else label = unit(Math.round(mins / 1440), 'día', 'días');

  if (label === 'ahora') return label;
  return diff < 0 ? `hace ${label}` : `en ${label}`;
}

export function isOverdue(dueAt: Date | string | null | undefined): boolean {
  if (!dueAt) return false;
  return new Date(dueAt).getTime() < Date.now();
}

/* ── Métricas ──────────────────────────────────────────────────────────── */

/**
 * Divisor cero devuelve null, NO Infinity ni 0.
 * "ROAS ∞" y "ROAS 0 %" son las dos formas de mentir sobre lo mismo:
 * que todavía no hay datos suficientes para calcularlo.
 */
export function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

export function fmtPercent(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(decimals).replace('.', ',')} %`;
}

export function fmtNumber(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('es-ES').format(v);
}
