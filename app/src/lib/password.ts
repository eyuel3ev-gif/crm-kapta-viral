import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number,
) => Promise<Buffer>;

/**
 * Contraseñas con scrypt.
 *
 * scrypt viene en Node, así que no añade dependencias, y es deliberadamente
 * lento y caro en memoria: si algún día se filtra la tabla de usuarios, probar
 * contraseñas a lo bruto sale carísimo. Un hash rápido como SHA-256 se rompe
 * en minutos con una GPU.
 *
 * Cada contraseña lleva su propia sal, así que dos personas con la misma
 * contraseña producen hashes distintos.
 */

const KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 10) {
    throw new Error('PASSWORD_TOO_SHORT: mínimo 10 caracteres.');
  }
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  // Sin contraseña guardada NO se entra. Un usuario sin credencial es un
  // usuario que todavía no puede acceder, no uno que entra sin más.
  if (!stored) return false;

  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;

  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');

  let derived: Buffer;
  try {
    derived = await scryptAsync(plain, salt, expected.length);
  } catch {
    return false;
  }

  // Comparación en tiempo constante: comparar con === filtra información
  // sobre cuántos caracteres del hash coincidían.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
