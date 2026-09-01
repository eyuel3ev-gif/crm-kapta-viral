import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Tone } from '@/lib/labels';

/* ── Tono → color. Un único sitio donde se decide qué significa cada color. */
const TONE: Record<Tone, string> = {
  neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
  positive: 'bg-green-50 text-green-800 ring-green-200',
  negative: 'bg-red-50 text-red-800 ring-red-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  info: 'bg-blue-50 text-blue-800 ring-blue-200',
  ai: 'bg-violet-50 text-violet-800 ring-violet-200',
};

export function Badge({ tone = 'neutral', children, className }: {
  tone?: Tone; children: ReactNode; className?: string;
}) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
      TONE[tone], className,
    )}>{children}</span>
  );
}

export function Card({ children, className, title, action }: {
  children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode;
}) {
  return (
    <section className={cn('rounded-lg border border-neutral-200 bg-white', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  children, variant = 'primary', size = 'md', type = 'button', className, ...rest
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning';
  size?: 'sm' | 'md';
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary: 'bg-neutral-900 text-white hover:bg-neutral-800 border-neutral-900',
    secondary: 'bg-white text-neutral-800 hover:bg-neutral-50 border-neutral-300',
    ghost: 'bg-transparent text-neutral-600 hover:bg-neutral-100 border-transparent',
    danger: 'bg-red-600 text-white hover:bg-red-700 border-red-600',
    success: 'bg-green-700 text-white hover:bg-green-800 border-green-700',
    warning: 'bg-amber-500 text-white hover:bg-amber-600 border-amber-500',
  };
  return (
    <button type={type} {...rest} className={cn(
      'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors',
      'disabled:opacity-50 disabled:pointer-events-none',
      size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
      variants[variant], className,
    )}>{children}</button>
  );
}

export function LinkButton({ href, children, variant = 'secondary', size = 'md', className }: {
  href: string; children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost'; size?: 'sm' | 'md'; className?: string;
}) {
  const variants = {
    primary: 'bg-neutral-900 text-white hover:bg-neutral-800 border-neutral-900',
    secondary: 'bg-white text-neutral-800 hover:bg-neutral-50 border-neutral-300',
    ghost: 'bg-transparent text-neutral-600 hover:bg-neutral-100 border-transparent',
  };
  return (
    <Link href={href} className={cn(
      'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors',
      size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
      variants[variant], className,
    )}>{children}</Link>
  );
}

/**
 * Tarjeta de métrica.
 * `value` acepta null y pinta "—". Es deliberado: un dato que no tenemos
 * NO puede mostrarse como 0, porque quien lo lee decide sobre él.
 */
export function Stat({ label, value, hint, delta, tone = 'neutral' }: {
  label: string; value: ReactNode; hint?: string;
  delta?: number | null; tone?: Tone;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="tnum text-2xl font-semibold text-neutral-900">{value}</span>
        {delta !== null && delta !== undefined && (
          <span className={cn(
            'tnum text-xs font-medium',
            delta > 0 ? 'text-green-700' : delta < 0 ? 'text-red-700' : 'text-neutral-500',
          )}>
            {delta > 0 ? '+' : ''}{(delta * 100).toFixed(0)} %
          </span>
        )}
      </div>
      {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-neutral-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50/60">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 text-xs font-medium text-neutral-500 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('px-3 py-2 align-middle', className)}>{children}</td>;
}

export function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean; children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-700">
        {label}{required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

const inputBase =
  'w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm ' +
  'placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputBase, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(inputBase, 'min-h-[72px] resize-y', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(inputBase, 'pr-8', props.className)} />;
}

/** Dato que no tenemos. Nunca 0, nunca "No". */
export function Unknown({ label = 'No disponible' }: { label?: string }) {
  return <span className="text-xs text-neutral-400 italic">{label}</span>;
}

export function PageHeader({ title, subtitle, actions }: {
  title: string; subtitle?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-neutral-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, base }: {
  tabs: { key: string; label: string; count?: number }[];
  active: string; base: string;
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-neutral-200">
      {tabs.map((t) => (
        <Link key={t.key}
          href={t.key === tabs[0].key ? base : `${base}?tab=${t.key}`}
          className={cn(
            'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium -mb-px',
            active === t.key
              ? 'border-neutral-900 text-neutral-900'
              : 'border-transparent text-neutral-500 hover:text-neutral-800',
          )}>
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="ml-1.5 rounded bg-neutral-100 px-1 text-xs tnum">{t.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-neutral-100 py-1.5 last:border-0">
      <dt className="w-40 shrink-0 text-xs text-neutral-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-neutral-900">{children}</dd>
    </div>
  );
}

export function Alert({ tone = 'warning', title, children, href }: {
  tone?: Tone; title: string; children?: ReactNode; href?: string;
}) {
  const border = {
    neutral: 'border-l-neutral-400', positive: 'border-l-green-600',
    negative: 'border-l-red-600', warning: 'border-l-amber-500',
    info: 'border-l-blue-600', ai: 'border-l-violet-600',
  }[tone];
  const body = (
    <div className={cn('border-l-2 bg-white px-3 py-2.5', border)}>
      <p className="text-sm font-medium text-neutral-900">{title}</p>
      {children && <p className="mt-0.5 text-xs text-neutral-600">{children}</p>}
    </div>
  );
  return href ? <Link href={href} className="block hover:bg-neutral-50">{body}</Link> : body;
}
