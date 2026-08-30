import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  type?: 'success' | 'error' | 'info';
  action?: ToastAction;
  /** Override the default 5s auto-dismiss (ms). */
  duration?: number;
}

interface ToastEntry {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
  action?: ToastAction;
}

const ToastContext = createContext<{ show: (message: string, options?: ToastOptions | 'success' | 'error' | 'info') => void }>({
  show: () => undefined,
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((items) => items.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, options: ToastOptions | 'success' | 'error' | 'info' = {}) => {
      const config: ToastOptions = typeof options === 'string' ? { type: options } : options;
      const id = nextId.current++;
      const entry: ToastEntry = {
        id,
        message,
        type: config.type ?? 'success',
        action: config.action,
      };
      setToasts((items) => [...items.slice(-3), entry]);
      window.setTimeout(() => dismiss(id), config.duration ?? 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="vz-toasts" aria-live="polite" role="status">
        {toasts.map((toast) => (
          <div className={`vz-toast vz-toast--${toast.type}`} key={toast.id}>
            <span style={{ flex: 1 }}>{toast.message}</span>
            {toast.action && (
              <button
                className="vz-toast__action"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
