import { useState, type ReactNode } from 'react';
import type { Role, ServerStatus } from '@reforger-panel/shared';
import { ROLE_LABELS } from '@reforger-panel/shared';

export function Card({
  title,
  action,
  children,
  className = '',
  padded = true,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`panel-card ${className}`}>
      {title !== undefined && (
        <header className="panel-card-header">
          <h2 className="panel-card-title">{title}</h2>
          {action}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

/** Image with a quiet placeholder when the URL is missing or fails to load. */
export function ModImage({ src, className = '' }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-md border border-graphite-700 bg-graphite-800 text-slate-dim ${className}`}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-1/2 w-1/2" stroke="currentColor">
          <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="1.5" />
          <circle cx="9" cy="10" r="1.75" strokeWidth="1.5" />
          <path d="M4 18l5-5 3 3 4-4 4 4" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-md border border-graphite-700 object-cover ${className}`}
    />
  );
}

const STATUS_STYLES: Record<ServerStatus, { dot: string; text: string; label: string }> = {
  online: { dot: 'bg-accent-400', text: 'text-accent-400', label: 'Online' },
  offline: { dot: 'bg-zinc-500', text: 'text-zinc-400', label: 'Offline' },
  starting: { dot: 'bg-warn-400 animate-pulse', text: 'text-warn-400', label: 'Starting' },
  stopping: { dot: 'bg-warn-400 animate-pulse', text: 'text-warn-400', label: 'Stopping' },
  unknown: { dot: 'bg-zinc-600', text: 'text-zinc-500', label: 'Unknown' },
};

export function StatusBadge({ status }: { status: ServerStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unknown;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-current/20 bg-current/5 px-2.5 py-1 text-xs font-semibold ${style.text}`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

const ROLE_STYLES: Record<Role, string> = {
  owner: 'border-accent-500/40 bg-accent-500/10 text-accent-400',
  server_admin: 'border-sky-500/40 bg-sky-500/10 text-sky-400',
  mission_lead: 'border-warn-400/40 bg-warn-400/10 text-warn-400',
  viewer: 'border-zinc-600 bg-zinc-800/60 text-zinc-400',
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${ROLE_STYLES[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-graphite-700 bg-graphite-950/35 px-4 py-8 text-center">
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {hint && <p className="text-xs text-slate-dim">{hint}</p>}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-dim">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-graphite-600 border-t-accent-500" />
      {label}
    </div>
  );
}

export function StatBar({
  value,
  max,
  warnAt = 0.8,
}: {
  value: number;
  max: number | null;
  warnAt?: number;
}) {
  if (!max || max <= 0) return null;
  const ratio = Math.min(1, value / max);
  const color = ratio >= warnAt ? 'bg-warn-400' : 'bg-accent-500';
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-graphite-700">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'default',
  title,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'default' | 'accent' | 'danger';
  title?: string;
  type?: 'button' | 'submit';
}) {
  const variants = {
    default:
      'border-graphite-600 bg-graphite-800 text-zinc-300 hover:border-graphite-600 hover:bg-graphite-700',
    accent: 'border-accent-600/60 bg-accent-600/15 text-accent-400 hover:bg-accent-600/25',
    danger: 'border-danger-400/40 bg-danger-400/10 text-danger-400 hover:bg-danger-400/20',
  } as const;
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-9 items-center justify-center rounded-md border px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variants[variant]}`}
    >
      {children}
    </button>
  );
}
