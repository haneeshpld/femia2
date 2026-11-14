import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.tsx';

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Empty({ icon = 'sparkle', title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 64, n = 3 }: { h?: number; n?: number }) {
  return <div className="stack" aria-busy="true" aria-label="Loading">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} />)}</div>;
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="notice notice--bad" role="alert">
      <Icon name="info" />
      <div style={{ flex: 1 }}>{error instanceof Error ? error.message : 'Something went wrong.'}</div>
      {retry && <button className="btn btn--quiet" onClick={retry}>Try again</button>}
    </div>
  );
}

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="sheet">
      <div className="sheet__scrim" onClick={onClose} />
      <div className="sheet__panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet__head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close" autoFocus><Icon name="close" /></button></div>
        {children}
        {footer && <div className="row" style={{ marginTop: 'var(--sp-5)' }}>{footer}</div>}
      </div>
    </div>
  );
}

type Toast = { id: number; text: string; bad?: boolean; action?: { label: string; run: () => void } };
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { ...t, id }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.action ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast${t.bad ? ' toast--bad' : ''}`}>
            <span>{t.text}</span>
            {t.action && <button onClick={() => { t.action!.run(); setList((l) => l.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = { pending_payment: 'badge--warn', new: 'badge--maroon', confirmed: '', packed: '', shipped: 'badge--dark', delivered: 'badge--ok', cancelled: 'badge--bad', draft: 'badge--warn', active: 'badge--ok', archived: '' };
  const label: Record<string, string> = { pending_payment: 'Awaiting payment', new: 'New', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', draft: 'Draft', active: 'Live', archived: 'Archived' };
  return <span className={`badge ${cls[status] ?? ''}`}>{label[status] ?? status}</span>;
}
