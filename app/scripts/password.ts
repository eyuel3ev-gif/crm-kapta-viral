/**
 * Establece o cambia la contraseña de un usuario.
 *
 *   npm run user:password -- alvar@kaptaviral.com "una-contraseña-larga"
 *
 * Con DATABASE_URL apuntando a Neon, cambia la de producción.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../src/db';
import { users } from '../src/db/schema';
import { hashPassword } from '../src/lib/password';

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Uso: npm run user:password -- <email> "<contraseña>"');
    process.exit(1);
  }

  const clean = email.trim().toLowerCase();
  const found = await db.select({ id: users.id, name: users.name })
    .from(users).where(eq(users.email, clean)).limit(1);

  if (!found.length) {
    console.error(`No existe ningún usuario con el email ${clean}`);
    process.exit(1);
  }

  await db.update(users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(users.id, found[0].id));

  console.log(`✓ Contraseña actualizada para ${found[0].name} (${clean})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
