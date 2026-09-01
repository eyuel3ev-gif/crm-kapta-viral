import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, userRoles } from '@/db/schema';
import { login, setSession, devAuthEnabled } from '@/lib/auth';
import { label, ROLE } from '@/lib/labels';
import { Button, Card, Field, Input } from '@/components/ui';

export const dynamic = 'force-dynamic';

/**
 * Acceso al CRM.
 *
 * En producción, email y contraseña. El selector de usuario sin contraseña
 * solo existe en desarrollo y `devAuthEnabled()` lo apaga en producción
 * aunque alguien deje DEV_AUTH=true por descuido en las variables — poner
 * este selector en internet sería dejar la puerta abierta.
 */
export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const dev = devAuthEnabled();

  async function signIn(formData: FormData) {
    'use server';
    const result = await login(
      String(formData.get('email') ?? ''),
      String(formData.get('password') ?? ''),
    );
    if (!result.ok) redirect(`/login?error=${encodeURIComponent(result.error)}`);
    redirect('/');
  }

  async function enterAsDev(formData: FormData) {
    'use server';
    if (!devAuthEnabled()) redirect('/login');
    await setSession(String(formData.get('userId')));
    redirect('/');
  }

  const devUsers = dev
    ? await db.select({ id: users.id, name: users.name, role: userRoles.roleCode })
        .from(users)
        .leftJoin(userRoles, eq(userRoles.userId, users.id))
        .orderBy(users.name)
    : [];

  const grouped = new Map<string, { id: string; name: string; roles: string[] }>();
  for (const u of devUsers) {
    const entry = grouped.get(u.id) ?? { id: u.id, name: u.name, roles: [] };
    if (u.role) entry.roles.push(u.role);
    grouped.set(u.id, entry);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">CRM Álvar</h1>
      <p className="mt-1 text-sm text-neutral-500">Kapta Viral</p>

      {sp.error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {sp.error}
        </div>
      )}

      <Card className="mt-5">
        <form action={signIn} className="space-y-3 px-4 py-4">
          <Field label="Email">
            <Input name="email" type="email" autoComplete="username" required
              placeholder="tu@kaptaviral.com" />
          </Field>
          <Field label="Contraseña">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          <Button type="submit" className="w-full">Entrar</Button>
        </form>
      </Card>

      {dev && grouped.size > 0 && (
        <>
          <p className="mt-6 text-xs font-medium text-neutral-500">
            Modo desarrollo · entrar sin contraseña
          </p>
          <Card className="mt-2">
            <ul className="divide-y divide-neutral-100">
              {[...grouped.values()].map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{u.name}</div>
                    <div className="text-xs text-neutral-500">
                      {u.roles.map((r) => label(ROLE, r)).join(' · ') || 'Sin rol'}
                    </div>
                  </div>
                  <form action={enterAsDev}>
                    <input type="hidden" name="userId" value={u.id} />
                    <Button size="sm" variant="secondary" type="submit">Entrar</Button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-3 text-xs text-neutral-500">
            Este bloque no aparece en producción, aunque quede DEV_AUTH=true.
          </p>
        </>
      )}
    </div>
  );
}
