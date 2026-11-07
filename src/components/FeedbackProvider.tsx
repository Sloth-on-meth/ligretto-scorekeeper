import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FeedbackContext, type ConfirmOptions, type ToastKind } from '../feedback';
import { surface, border, muted } from '../theme';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const TOAST_MS = 3500;

const KIND_STYLE: Record<ToastKind, { bg: string; border: string; text: string }> = {
  success: { bg: '#15502a', border: '#1a6634', text: '#bbf7d0' },
  error: { bg: '#3a1010', border: '#7f1d1d', text: '#fecaca' },
  info: { bg: surface, border, text: '#fff' },
};

export default function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = nextId.current++;
    setToasts(prev => [...prev.slice(-2), { id, message, kind }]);
    window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, TOAST_MS);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    setPending({ ...options, resolve });
  }), []);

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      pending.resolve(false);
      setPending(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}

      <div aria-live="polite" className="fixed top-3 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map(t => {
          const style = KIND_STYLE[t.kind];
          return (
            <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto rounded-xl px-4 py-3 text-sm font-bold shadow-lg max-w-md w-full"
              style={{ backgroundColor: style.bg, border: `1px solid ${style.border}`, color: style.text }}>
              {t.message}
            </div>
          );
        })}
      </div>

      {pending && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onMouseDown={e => { if (e.target === e.currentTarget) settle(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-title"
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ backgroundColor: surface, border: `1px solid ${border}` }}>
            <h3 id="confirm-title" className="text-lg font-black uppercase tracking-wide mb-2">{pending.title}</h3>
            {pending.message && <p className="text-sm mb-5" style={{ color: muted }}>{pending.message}</p>}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button autoFocus type="button" onClick={() => settle(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-wide"
                style={{ backgroundColor: '#111118', border: `1px solid ${border}`, color: '#fff' }}>
                Cancel
              </button>
              <button type="button" onClick={() => settle(true)}
                className="px-4 py-2.5 rounded-xl text-sm font-black uppercase tracking-wide"
                style={pending.danger
                  ? { backgroundColor: '#b91c1c', color: '#fff' }
                  : { backgroundColor: '#e02020', color: '#fff' }}>
                {pending.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}
