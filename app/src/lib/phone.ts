/**
 * Normalización de teléfono a E.164.
 *
 * Es la pieza de la que depende toda la deduplicación: si "612 34 56 78",
 * "+34612345678" y "0034 612345678" no colapsan al mismo string, el mismo
 * lead entra tres veces y el CPL sale mal.
 *
 * Mercado inicial España, así que el prefijo por defecto es +34. Se guarda
 * SIEMPRE el valor original en phone_raw: lo normalizado es para comparar,
 * lo crudo es para mostrar y para corregir errores.
 */

const DEFAULT_COUNTRY_CODE = '34';

/** Móviles y fijos españoles: 9 dígitos empezando por 6, 7, 8 o 9. */
const ES_NATIONAL = /^[6789]\d{8}$/;

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;

  // Fuera todo lo que no sea dígito, salvo un + inicial.
  let s = String(input).trim().replace(/[^\d+]/g, '');
  if (!s) return null;

  // 00 34 ... → +34 ...
  if (s.startsWith('00')) s = '+' + s.slice(2);

  if (s.startsWith('+')) {
    const digits = s.slice(1);
    if (digits.length < 8 || digits.length > 15) return null;
    return '+' + digits;
  }

  // Sin prefijo: si parece un número nacional español, se le pone el +34.
  if (ES_NATIONAL.test(s)) return `+${DEFAULT_COUNTRY_CODE}${s}`;

  // 34612345678 sin el +
  if (s.startsWith(DEFAULT_COUNTRY_CODE) && s.length === 11) return `+${s}`;

  // No sabemos interpretarlo. Devolver null es mejor que inventarse un
  // prefijo: un teléfono mal normalizado fusiona a dos personas distintas.
  return null;
}

/** Formato legible para pantalla: +34 612 34 56 78 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '—';
  const m = e164.match(/^\+34(\d{3})(\d{2})(\d{2})(\d{2})$/);
  if (m) return `+34 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return e164;
}

/** Para el botón "Llamar". */
export function telHref(e164: string | null | undefined): string | undefined {
  return e164 ? `tel:${e164}` : undefined;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (!s || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return null;
  return s;
}

/** Normaliza un nombre para comparar: sin tildes, sin dobles espacios. */
export function normalizeName(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
