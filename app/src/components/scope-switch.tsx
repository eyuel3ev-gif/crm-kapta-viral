import { redirect } from 'next/navigation';
import { cn } from '@/lib/cn';
import { setScopeMode, SCOPE_LABEL, type ScopeMode } from '@/lib/scope';

/**
 * Selector Evergreen / Lanzamiento / Todo.
 *
 * Vive en la cabecera y no en cada pantalla porque es contexto, no un filtro:
 * cambia el significado de todos los números de golpe, y quien lo mira tiene
 * que ver sin buscarlo cuál de los dos negocios está leyendo.
 */
export function ScopeSwitch({ current, back }: { current: ScopeMode; back?: string }) {
  async function change(formData: FormData) {
    'use server';
    const mode = String(formData.get('mode')) as ScopeMode;
    await setScopeMode(mode);
    redirect(String(formData.get('back') || '/'));
  }

  const modes: ScopeMode[] = ['all', 'evergreen', 'launch'];

  return (
    <form action={change} className="flex items-center gap-1">
      {/* Sin esto, cambiar de negocio te expulsa a Inicio desde cualquier pantalla. */}
      <input type="hidden" name="back" value={back ?? '/'} />
      {modes.map((m) => (
        <button key={m} type="submit" name="mode" value={m}
          className={cn(
            'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
            current === m
              ? 'border-neutral-900 bg-neutral-900 text-white'
              : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50',
          )}>
          {SCOPE_LABEL[m]}
        </button>
      ))}
    </form>
  );
}
