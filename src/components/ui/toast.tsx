import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, AlertOctagon, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
}

interface ToastContextType {
  toasts: ToastItem[];
  showToast: (toast: Omit<ToastItem, 'id'>) => void;
  dismissToast: (id: string) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ type, title, message }: Omit<ToastItem, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, type, title, message }]);
      setTimeout(() => {
        dismissToast(id);
      }, 3500);
    },
    [dismissToast]
  );

  const success = useCallback(
    (message: string, title?: string) => showToast({ type: 'success', title, message }),
    [showToast]
  );
  const error = useCallback(
    (message: string, title?: string) => showToast({ type: 'error', title, message }),
    [showToast]
  );
  const warning = useCallback(
    (message: string, title?: string) => showToast({ type: 'warning', title, message }),
    [showToast]
  );
  const info = useCallback(
    (message: string, title?: string) => showToast({ type: 'info', title, message }),
    [showToast]
  );

  return (
    <ToastContext.Provider
      value={{
        toasts,
        showToast,
        dismissToast,
        success,
        error,
        warning,
        info,
      }}
    >
      {children}
      {/* Toast Render Viewport */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      >
        {toasts.map((toast) => {
          const typeConfig = {
            success: {
              icon: CheckCircle2,
              border: 'border-inservice/40',
              bg: 'bg-surface',
              iconColor: 'text-inservice',
              titleColor: 'text-primary',
            },
            error: {
              icon: AlertOctagon,
              border: 'border-tier0-border',
              bg: 'bg-tier0-bg',
              iconColor: 'text-tier0',
              titleColor: 'text-tier0',
            },
            warning: {
              icon: AlertTriangle,
              border: 'border-tier1-border',
              bg: 'bg-tier1-bg',
              iconColor: 'text-tier1',
              titleColor: 'text-tier1',
            },
            info: {
              icon: Info,
              border: 'border-tier2-border',
              bg: 'bg-tier2-bg',
              iconColor: 'text-tier2',
              titleColor: 'text-primary',
            },
          }[toast.type];

          const Icon = typeConfig.icon;

          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 p-3 rounded-md border shadow-snow-dropdown text-xs transition-all animate-in fade-in-50 slide-in-from-bottom-2 duration-150',
                typeConfig.bg,
                typeConfig.border
              )}
            >
              <Icon className={cn('w-4 h-4 shrink-0 mt-0.5 stroke-[1.5]', typeConfig.iconColor)} />
              <div className="flex-1 min-w-0">
                {toast.title && (
                  <div className={cn('font-semibold text-xs', typeConfig.titleColor)}>
                    {toast.title}
                  </div>
                )}
                <div className="text-secondary text-2xs mt-0.5 leading-snug">{toast.message}</div>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
                className="p-1 rounded text-muted hover:text-primary hover:bg-hover transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
