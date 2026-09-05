import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Role, ServerStatus } from '@reforger-panel/shared';
import { ROLE_LABELS } from '@reforger-panel/shared';
import { Icon, Spinner16, type IconName } from './icons.js';

/* ------------------------------------------------------------------ layout */

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
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  kicker,
  actions,
}: {
  title: string;
  kicker?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {kicker && <p className="page-kicker">{kicker}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- buttons */

type ButtonVariant = 'default' | 'accent' | 'danger' | 'ghost' | 'subtle';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: 'border-graphite-600 bg-graphite-800 text-zinc-200 hover:bg-graphite-700',
  accent: 'border-accent-600 bg-accent-600/20 text-accent-300 hover:bg-accent-600/30',
  danger: 'border-danger-400/45 bg-danger-400/10 text-danger-400 hover:bg-danger-400/20',
  ghost:
    'border-transparent bg-transparent text-slate-ink hover:bg-graphite-800 hover:text-zinc-100',
  subtle:
    'border-transparent bg-graphite-850 text-slate-ink hover:bg-graphite-800 hover:text-zinc-100',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-7 gap-1.5 px-2 py-1 text-xs',
  md: 'min-h-8 gap-2 px-3 py-1.5 text-sm',
};

export function Button({
  children,
  onClick,
  disabled,
  loading,
  variant = 'default',
  size = 'md',
  icon,
  title,
  type = 'button',
  className = '',
}: {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  title?: string;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-sm border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
    >
      {loading ? (
        <Spinner16 className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      ) : (
        icon && <Icon name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      )}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  variant = 'ghost',
  size = 'md',
}: {
  icon: IconName;
  /** Required: icon-only controls must still be announced. */
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANTS[variant]} ${size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'}`}
    >
      <Icon name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </button>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <span className="mt-1 block text-xs text-danger-400">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-slate-dim">{hint}</span>
      )}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={`relative ${className}`}>
      <Icon
        name="search"
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-dim"
      />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="input pl-8"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-dim hover:text-zinc-200"
        >
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'border-accent-500 bg-accent-600/50' : 'border-graphite-600 bg-graphite-800'
      }`}
    >
      <span
        className={`h-3.5 w-3.5 rounded-full bg-zinc-200 transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName; count?: number }[];
  onChange: (value: T) => void;
  size?: ButtonSize;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex items-center gap-0.5 rounded-sm border border-graphite-700 bg-graphite-950 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 rounded-xs font-semibold transition-colors ${
              size === 'sm' ? 'px-2 py-1 text-2xs' : 'px-2.5 py-1.5 text-xs'
            } ${
              active
                ? 'bg-graphite-700 text-zinc-100'
                : 'text-slate-dim hover:bg-graphite-850 hover:text-zinc-200'
            }`}
          >
            {option.icon && <Icon name={option.icon} className="h-3.5 w-3.5" />}
            {option.label}
            {option.count !== undefined && (
              <span className="numeric text-2xs text-slate-dim">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ status */

const STATUS_STYLES: Record<ServerStatus, { dot: string; text: string; label: string }> = {
  online: {
    dot: 'bg-ok-400 shadow-[0_0_8px_var(--color-ok-400)]',
    text: 'text-ok-400',
    label: 'Online',
  },
  offline: { dot: 'bg-slate-faint', text: 'text-slate-dim', label: 'Offline' },
  starting: { dot: 'bg-warn-400 animate-pulse', text: 'text-warn-400', label: 'Starting' },
  stopping: { dot: 'bg-warn-400 animate-pulse', text: 'text-warn-400', label: 'Stopping' },
  unknown: { dot: 'bg-graphite-500', text: 'text-slate-faint', label: 'Unknown' },
};

export function StatusBadge({ status, compact }: { status: ServerStatus; compact?: boolean }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unknown;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-current/20 bg-current/5 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider ${style.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {!compact && style.label}
    </span>
  );
}

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border-graphite-600 bg-graphite-800 text-slate-ink',
  accent: 'border-accent-600/50 bg-accent-600/12 text-accent-300',
  ok: 'border-ok-400/40 bg-ok-400/10 text-ok-400',
  warn: 'border-warn-400/40 bg-warn-400/10 text-warn-400',
  danger: 'border-danger-400/40 bg-danger-400/10 text-danger-400',
  info: 'border-info-400/40 bg-info-400/10 text-info-400',
};

export function Badge({
  children,
  tone = 'neutral',
  icon,
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: IconName;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-xs border px-1.5 py-0.5 text-2xs font-semibold ${BADGE_TONES[tone]}`}
    >
      {icon && <Icon name={icon} className="h-3 w-3" />}
      {children}
    </span>
  );
}

const ROLE_TONES: Record<Role, BadgeTone> = {
  owner: 'accent',
  server_admin: 'info',
  mission_lead: 'warn',
  viewer: 'neutral',
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge tone={ROLE_TONES[role]}>
      <span className="uppercase tracking-wider">{ROLE_LABELS[role]}</span>
    </Badge>
  );
}

/* ------------------------------------------------------------- placeholders */

export function EmptyState({
  title,
  hint,
  icon = 'info',
  action,
}: {
  title: string;
  hint?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-graphite-700 bg-graphite-950/50 px-4 py-10 text-center">
      <Icon name={icon} className="h-5 w-5 text-slate-faint" />
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {hint && <p className="max-w-md text-xs leading-5 text-slate-dim">{hint}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-dim">
      <Spinner16 className="h-4 w-4 text-accent-400" />
      {label}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xs bg-graphite-800 ${className}`} />;
}

/** Image with a quiet placeholder when the URL is missing or fails to load. */
export function ModImage({ src, className = '' }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-xs border border-graphite-700 bg-graphite-800 text-slate-faint ${className}`}
      >
        <Icon name="image" className="h-1/2 w-1/2" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-xs border border-graphite-700 object-cover ${className}`}
    />
  );
}

/* ------------------------------------------------------------------ meters */

export function ProgressBar({
  value,
  max,
  warnAt = 0.75,
  dangerAt = 0.9,
  className = '',
}: {
  value: number;
  max: number | null;
  warnAt?: number;
  dangerAt?: number;
  className?: string;
}) {
  if (!max || max <= 0) return null;
  const ratio = Math.min(1, Math.max(0, value / max));
  const color =
    ratio >= dangerAt ? 'bg-danger-400' : ratio >= warnAt ? 'bg-warn-400' : 'bg-accent-500';
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full bg-graphite-800 ${className}`}>
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

export function MetricTile({
  label,
  value,
  unit,
  detail,
  children,
}: {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="panel-card p-4">
      <p className="eyebrow">{label}</p>
      <p className="numeric mt-1.5 text-2xl font-semibold leading-none text-zinc-50">
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-slate-dim">{unit}</span>}
      </p>
      {detail && <div className="numeric mt-1 text-xs text-slate-dim">{detail}</div>}
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------ dialog */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headingId = useId();

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      // Keep focus inside the dialog.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    panelRef.current?.querySelector<HTMLElement>('input, button')?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={`animate-fade-in relative z-10 my-auto w-full ${widths[width]} rounded-md border border-graphite-700 bg-graphite-900 shadow-2xl shadow-black/60`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-graphite-700 px-4 py-3">
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-zinc-50">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-slate-dim">{description}</p>}
          </div>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-graphite-700 px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  variant = 'danger',
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-6 text-slate-ink">{body}</div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ toasts */

type Toast = { id: number; tone: BadgeTone; message: string };

const ToastContext = createContext<(message: string, tone?: BadgeTone) => void>(() => {});

/** `toast('Saved')` from anywhere below <ToastProvider>. */
export function useToast() {
  return useContext(ToastContext);
}

const TOAST_TONES: Record<BadgeTone, string> = {
  neutral: 'border-graphite-600 bg-graphite-800 text-zinc-100',
  accent: 'border-accent-600 bg-graphite-800 text-accent-300',
  ok: 'border-ok-400/50 bg-graphite-800 text-ok-400',
  warn: 'border-warn-400/50 bg-graphite-800 text-warn-400',
  danger: 'border-danger-400/50 bg-graphite-800 text-danger-400',
  info: 'border-info-400/50 bg-graphite-800 text-info-400',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((message: string, tone: BadgeTone = 'neutral') => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    const timer = setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      tone === 'danger' ? 8_000 : 4_500,
    );
    return () => clearTimeout(timer);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`animate-fade-in pointer-events-auto flex items-start gap-2 rounded-sm border px-3 py-2 text-xs leading-5 shadow-lg shadow-black/40 ${TOAST_TONES[toast.tone]}`}
          >
            <Icon
              name={toast.tone === 'danger' ? 'alert' : toast.tone === 'ok' ? 'check' : 'info'}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span className="min-w-0 flex-1">{toast.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              className="text-current/60 hover:text-current"
            >
              <Icon name="close" className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------------ notices */

export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'ok';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: 'border-info-400/35 bg-info-400/[0.07] text-info-400',
    warn: 'border-warn-400/35 bg-warn-400/[0.07] text-warn-400',
    danger: 'border-danger-400/35 bg-danger-400/[0.07] text-danger-400',
    ok: 'border-ok-400/35 bg-ok-400/[0.07] text-ok-400',
  } as const;
  return (
    <div
      className={`flex flex-wrap items-start gap-3 rounded-sm border px-3 py-2.5 ${tones[tone]}`}
    >
      <Icon
        name={tone === 'ok' ? 'check' : tone === 'info' ? 'info' : 'alert'}
        className="mt-0.5 h-4 w-4"
      />
      <div className="min-w-0 flex-1 text-xs leading-5">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-slate-ink">{children}</div>
      </div>
      {action}
    </div>
  );
}
