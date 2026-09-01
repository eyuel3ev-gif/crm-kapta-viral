import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, userRoles } from '@/db/schema';
import { verifyPassword } from './password';

export type RoleCode = 'owner' | 'setter' | 'closer';

export type Session = {
  userId: string;
  name: string;
  email: string;
  roles: RoleCode[];
};

const COOKIE = 'crm_session';
const MAX_AGE_DAYS = 14;

/**
 * Sesiones firmadas.
 *
 * La cookie lleva `userId.expira.firma`. La firma es un HMAC con el secreto
 * del servidor, así que nadie puede fabricarse una sesión cambiando el id a
 * mano: sin el secreto no sabe firmar. Y como incluye la caducidad dentro de
 * lo firmado, tampoco puede alargarla.
 *
 * No hace falta tabla de sesiones — para cinco personas sería complicarlo por
 * nada. El precio es que cerrar sesión en un dispositivo no la cierra en los
 * demás; a este tamaño, aceptable.
 */

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'SESSION_SECRET ausente o demasiado corto (mínimo 32 caracteres). ' +
      'Genera uno con: openssl rand -base64 48',
    );
  }
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function makeToken(userId: string): string {
  const expires = Date.now() + MAX_AGE_DAYS * 86400_000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiresRaw, signature] = parts;

  const expected = sign(`${userId}.${expiresRaw}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;

  return userId;
}

/* ── Sesión ──────────────────────────────────────────────────────────── */

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const userId = readToken(jar.get(COOKIE)?.value);
  if (!userId) return null;

  const rows = await db
    .select({
      id: users.id, name: users.name, email: users.email,
      active: users.active, role: userRoles.roleCode,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .where(eq(users.id, userId));

  // Desactivar a alguien le cierra la puerta en la siguiente petición, sin
  // esperar a que caduque su cookie.
  if (rows.length === 0 || !rows[0].active) return null;

  return {
    userId: rows[0].id,
    name: rows[0].name,
    email: rows[0].email,
    roles: rows.map((r) => r.role).filter(Boolean) as RoleCode[],
  };
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error('UNAUTHENTICATED');
  return s;
}

/* ── Entrar y salir ──────────────────────────────────────────────────── */

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  const clean = email.trim().toLowerCase();

  const rows = await db.select({
    id: users.id, active: users.active, passwordHash: users.passwordHash,
  }).from(users).where(eq(users.email, clean)).limit(1);

  const user = rows[0];
  const valid = await verifyPassword(password, user?.passwordHash ?? null);

  // Mismo mensaje para "no existe" y "contraseña incorrecta": distinguirlos
  // permite averiguar qué emails tienen cuenta.
  if (!user || !user.active || !valid) {
    return { ok: false, error: 'Email o contraseña incorrectos.' };
  }

  await setSession(user.id);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return { ok: true };
}

export async function setSession(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE, makeToken(userId), {
    httpOnly: true,                                   // JavaScript no la ve
    secure: process.env.NODE_ENV === 'production',    // solo por HTTPS
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_DAYS * 86400,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Solo fuera de producción: el selector de usuario sin contraseña. */
export function devAuthEnabled(): boolean {
  return process.env.DEV_AUTH === 'true' && process.env.NODE_ENV !== 'production';
}

/* ── Roles ───────────────────────────────────────────────────────────── */

export function hasRole(session: Session, role: RoleCode): boolean {
  return session.roles.includes(role);
}

/** Un usuario puede ser Owner Y Setter a la vez (Álvar lo es). */
export function primaryRole(session: Session): RoleCode {
  if (session.roles.includes('owner')) return 'owner';
  if (session.roles.includes('closer')) return 'closer';
  return 'setter';
}

export function homePathFor(session: Session): string {
  switch (primaryRole(session)) {
    case 'owner': return '/owner';
    case 'closer': return '/closer/reuniones';
    default: return '/setter/mi-trabajo';
  }
}

export function generateSecret(): string {
  return randomBytes(48).toString('base64');
}
