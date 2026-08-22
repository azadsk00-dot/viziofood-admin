/**
 * Vizio Food design-system primitives. Pure React + the vz-* CSS classes —
 * no third-party UI kit. Every surface (customer, admin, kitchen) builds on
 * these so spacing, focus states, and behaviour stay consistent.
 */

import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
  useRef,
} from 'react';
import { X } from 'lucide-react';

// ─── Button ────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';

export function Button({
  variant = 'primary',
  size,
  block,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'lg';
  block?: boolean;
}) {
  const classes = [
    'vz-btn',
    `vz-btn--${variant}`,
    size ? `vz-btn--${size}` : '',
    block ? 'vz-btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}

// ─── Form fields ───────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="vz-field">
      <label className="vz-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <span className="vz-field__hint">{hint}</span>}
      {error && <span className="vz-field__error" role="alert">{error}</span>}
    </div>
  );
}

export function Input({
  invalid,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={`vz-input ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({
  invalid,
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={`vz-textarea ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`vz-select ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="vz-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="vz-toggle__track">
        <span className="vz-toggle__thumb" />
      </span>
      <span className="vz-toggle__label">{label}</span>
    </label>
  );
}

// ─── Badge ─────────────────────────────────────────────────────────────────

type BadgeTone = 'neutral' | 'success' | 'danger' | 'info' | 'gold' | 'olive' | 'terracotta';

export function Badge({ tone = 'neutral', dot, children }: { tone?: BadgeTone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`vz-badge vz-badge--${tone}`}>
      {dot && <span className="vz-dot" />}
      {children}
    </span>
  );
}

/** Consistent tone for every order status across admin + kitchen. */
export const orderStatusTone = (status: string): BadgeTone => {
  switch (status) {
    case 'New': return 'terracotta';
    case 'Accepted': return 'info';
    case 'Preparing': return 'gold';
    case 'Ready': return 'olive';
    case 'Completed': return 'success';
    case 'Cancelled':
    case 'Rejected': return 'danger';
    default: return 'neutral';
  }
};

// ─── Card ──────────────────────────────────────────────────────────────────

export function Card({ pad, flat, className = '', style, children }: { pad?: boolean; flat?: boolean; className?: string; style?: React.CSSProperties; children: ReactNode }) {
  const classes = ['vz-card', pad && 'vz-card--pad', flat && 'vz-card--flat', className].filter(Boolean).join(' ');
  return <div className={classes} style={style}>{children}</div>;
}

// ─── Modal ─────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  wide,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="vz-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`vz-modal ${wide ? 'vz-modal--wide' : ''}`} ref={ref} tabIndex={-1}>
        <div className="vz-modal__header">
          <h2 className="vz-modal__title">{title}</h2>
          <button className="vz-btn vz-btn--ghost vz-btn--sm" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div className="vz-modal__body">{children}</div>
        {footer && <div className="vz-modal__footer">{footer}</div>}
      </div>
    </div>
  );
}

// ─── Drawer ────────────────────────────────────────────────────────────────

export function Drawer({
  open,
  onClose,
  title,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="vz-drawer-overlay" onMouseDown={onClose} />
      <aside className="vz-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="vz-drawer__header">
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{title}</h2>
          <button className="vz-btn vz-btn--ghost vz-btn--sm" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="vz-drawer__body">{children}</div>
        {footer && <div className="vz-drawer__footer">{footer}</div>}
      </aside>
    </>
  );
}

// ─── Tabs ──────────────────────────────────────────────────────────────────

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="vz-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === active}
          className={`vz-tab ${tab.id === active ? 'vz-tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && ` (${tab.count})`}
        </button>
      ))}
    </div>
  );
}

// ─── States ────────────────────────────────────────────────────────────────

export function Skeleton({ height = 18, width, style }: { height?: number; width?: number | string; style?: React.CSSProperties }) {
  return <div className="vz-skeleton" style={{ height, width, ...style }} />;
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="vz-empty">
      {icon && <div className="vz-empty__icon">{icon}</div>}
      <div className="vz-empty__title">{title}</div>
      {children && <div className="vz-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return <div className="vz-error-box" role="alert">{children}</div>;
}

export function Spinner() {
  return <span className="vz-spinner" aria-label="Loading" />;
}
