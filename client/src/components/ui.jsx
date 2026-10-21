import { LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function Button({ variant = 'primary', size, icon: Icon, loading, children, className = '', ...props }) {
  return (
    <button type="button" className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`} disabled={loading || props.disabled} {...props}>
      {loading ? <LoaderCircle size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function Card({ title, subtitle, actions, children, className = '', padded = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

const STATUS_TONES = {
  queued: 'neutral',
  running: 'info',
  review: 'warning',
  approved: 'success',
  merged: 'success',
  rejected: 'danger',
  failed: 'danger',
  cancelled: 'neutral',
  pending: 'neutral',
  accepted: 'success',
  done: 'success',
  pass: 'success',
  warn: 'warning',
  fail: 'danger',
  info: 'info',
  critical: 'danger',
  warning: 'warning',
  high: 'danger',
  medium: 'warning',
  low: 'success',
};

const STATUS_LABELS = { review: 'In review', warn: 'Warning', pass: 'Pass', fail: 'Fail' };

export function Badge({ tone = 'neutral', children, className = '' }) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>;
}

export function StatusBadge({ status, label }) {
  if (!status) return null;
  return (
    <Badge tone={STATUS_TONES[status] || 'neutral'}>
      {status === 'running' && <LoaderCircle size={12} className="spin" />}
      {label || STATUS_LABELS[status] || status[0].toUpperCase() + status.slice(1)}
    </Badge>
  );
}

export function LangBadge({ language, label }) {
  return <span className={`lang lang-${language}`}>{label || language}</span>;
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={active === t.id} className={`tab${active === t.id ? ' active' : ''}`} onClick={() => onChange(t.id)} disabled={t.disabled}>
          {t.icon && <t.icon size={16} />}
          <span>{t.label}</span>
          {t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return (
    <div className="spinner-wrap" role="status">
      <LoaderCircle size={22} className="spin" />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && (
        <div className="empty-icon">
          <Icon size={26} />
        </div>
      )}
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Modal({ open, title, children, onClose, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, message, confirmLabel = 'Confirm', danger, loading, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function Stat({ label, value, hint, icon: Icon, tone }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      {Icon && (
        <div className="stat-icon">
          <Icon size={18} />
        </div>
      )}
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </div>
  );
}
