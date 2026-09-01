import type { Metadata } from 'next';
import { ensureDbReady } from '@/db/bootstrap';
import './globals.css';

export const metadata: Metadata = {
  title: 'CRM Álvar',
  description: 'Sistema operativo comercial del lanzamiento',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Solo hace algo con el Postgres embebido y solo la primera vez: crea el
  // schema y siembra los datos. Con DATABASE_URL configurada no toca nada.
  await ensureDbReady();

  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
