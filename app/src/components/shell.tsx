import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Session } from '@/lib/auth';
import { primaryRole } from '@/lib/auth';
import { ROLE, label } from '@/lib/labels';
import { ScopeSwitch } from './scope-switch';
import { getScopeMode } from '@/lib/scope';

type Item = { href: string; label: string };

/**
 * Cada rol tiene su propia navegación, no el mismo CRM con botones ocultos.
 * El setter no necesita ver que existe una sección de Fuentes: verla y no
 * poder entrar es peor que no tenerla.
 */
const NAV: Record<string, Item[]> = {
  owner: [
    { href: '/owner', label: 'Inicio' },
    { href: '/owner/leads', label: 'Leads' },
    { href: '/owner/tareas', label: 'Tareas' },
    { href: '/owner/facturacion', label: 'Facturación' },
    { href: '/owner/equipo', label: 'Equipo' },
  ],
  setter: [
    { href: '/setter/mi-trabajo', label: 'Mi trabajo' },
    { href: '/setter/mis-leads', label: 'Mis leads' },
    { href: '/setter/mis-tareas', label: 'Mis tareas' },
  ],
  closer: [
    { href: '/closer/reuniones', label: 'Reuniones' },
    { href: '/closer/mis-leads', label: 'Mis leads' },
  ],
};

export async function Shell({ session, children, current }: {
  session: Session; children: ReactNode; current: string;
}) {
  // El selector solo lo ven los propietarios: el setter y el closer trabajan
  // la cola que les toca, sea del negocio que sea.
  const isOwner = session.roles.includes('owner');
  const scopeMode = await getScopeMode();
  const role = primaryRole(session);

  // Álvar es Owner y Setter a la vez: se le muestran ambas navegaciones.
  const sections = session.roles.includes('owner')
    ? [
        { role: 'owner', items: NAV.owner },
        ...(session.roles.includes('setter') ? [{ role: 'setter', items: NAV.setter }] : []),
        ...(session.roles.includes('closer') ? [{ role: 'closer', items: NAV.closer }] : []),
      ]
    : [{ role, items: NAV[role] }];

  const linkClass = (href: string) => cn(
    'rounded-md px-2 py-1.5 text-sm whitespace-nowrap',
    current === href
      ? 'bg-neutral-900 font-medium text-white'
      : 'text-neutral-700 hover:bg-neutral-100',
  );

  return (
    <div className="lg:flex lg:min-h-screen">
      {/* ── Pantallas estrechas: barra superior con la navegación en una
             fila desplazable. Una barra lateral fija de 224 px se come una
             ventana de 300 px y deja el contenido sin sitio. ───────────── */}
      <header className="border-b border-neutral-200 bg-white lg:hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div>
            <div className="text-sm font-semibold tracking-tight">CRM Álvar</div>
            <div className="text-[11px] text-neutral-500">
              {session.name} · {session.roles.map((r) => label(ROLE, r)).join(' · ')}
            </div>
          </div>
          <Link href="/login" className="shrink-0 text-xs text-neutral-500 underline hover:text-neutral-900">
            Cambiar
          </Link>
        </div>
        {isOwner && <div className="px-3 pb-2"><ScopeSwitch current={scopeMode} back={current} /></div>}
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
          {sections.flatMap((s) => s.items).map((item) => (
            <Link key={item.href} href={item.href} className={linkClass(item.href)}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* ── Escritorio: barra lateral ──────────────────────────────────── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-neutral-200 bg-white lg:flex">
        <div className="border-b border-neutral-200 px-4 py-3">
          <div className="text-sm font-semibold tracking-tight">CRM Álvar</div>
          <div className="text-xs text-neutral-500">Kapta Viral</div>
        </div>

        {isOwner && (
          <div className="border-b border-neutral-200 px-3 py-2.5">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              Negocio
            </div>
            <ScopeSwitch current={scopeMode} back={current} />
          </div>
        )}

        <nav className="flex-1 p-2">
          {sections.map((section, i) => (
            <div key={section.role} className={cn(i > 0 && 'mt-4')}>
              {sections.length > 1 && (
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  {label(ROLE, section.role)}
                </div>
              )}
              {section.items.map((item) => (
                <Link key={item.href} href={item.href} className={cn('block', linkClass(item.href))}>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-neutral-200 px-4 py-3 text-xs">
          <div className="font-medium text-neutral-800">{session.name}</div>
          <div className="text-neutral-500">
            {session.roles.map((r) => label(ROLE, r)).join(' · ')}
          </div>
          <Link href="/login" className="mt-1.5 inline-block text-neutral-500 underline hover:text-neutral-900">
            Cambiar usuario
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-3 py-4 lg:px-6 lg:py-5">{children}</main>
    </div>
  );
}
