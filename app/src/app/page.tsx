import { redirect } from 'next/navigation';
import { getSession, homePathFor } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/login');
  redirect(homePathFor(session));
}
