import React, { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'pending';

export interface ToastData {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, 0 = persistent
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  pending: (
    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  ),
};

const STYLES: Record<ToastType, { bg: string; icon: string; border: string }> = {
  success: {
    bg: 'bg-green-50',
    icon: 'bg-green-500 text-white',
    border: 'border-green-200',
  },
  error: {
    bg: 'bg-red-50',
    icon: 'bg-red-500 text-white',
    border: 'border-red-200',
  },
  info: {
    bg: 'bg-blue-50',
    icon: 'bg-blue-500 text-white',
    border: 'border-blue-200',
  },
  pending: {
    bg: 'bg-amber-50',
    icon: 'bg-amber-500 text-white',
    border: 'border-amber-200',
  },
};

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const style = STYLES[toast.type];

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  };

  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const startTime = Date.now();
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 100 - (elapsed / toast.duration!) * 100);
        setProgress(remaining);

        if (remaining <= 0) {
          clearInterval(interval);
          handleDismiss();
        }
      }, 50);

      return () => clearInterval(interval);
    }
  }, [toast.duration]);

  return (
    <div
      className={`
        relative overflow-hidden
        ${style.bg} ${style.border} border
        rounded-2xl shadow-lg
        transform transition-all duration-200 ease-out
        ${isExiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
      `}
      role="alert"
    >
      <div className="p-4 flex items-start gap-3">
        {/* Icon */}
        <div className={`${style.icon} w-8 h-8 rounded-xl flex items-center justify-center shrink-0`}>
          {ICONS[toast.type]}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="font-bold text-slate-900 text-sm">{toast.title}</p>
          {toast.message && (
            <p className="text-slate-600 text-sm mt-0.5 leading-relaxed">{toast.message}</p>
          )}
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className="mt-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              {toast.action.label}
            </button>
          )}
        </div>

        {/* Dismiss button (not for pending) */}
        {toast.type !== 'pending' && (
          <button
            onClick={handleDismiss}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1 -mr-1 -mt-1"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Progress bar for timed toasts */}
      {toast.duration && toast.duration > 0 && (
        <div className="h-1 bg-slate-200/50">
          <div
            className={`h-full transition-all duration-100 ease-linear ${
              toast.type === 'success' ? 'bg-green-400' :
              toast.type === 'error' ? 'bg-red-400' :
              toast.type === 'info' ? 'bg-blue-400' :
              'bg-amber-400'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
};

// Toast Container - renders all toasts
interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 w-full max-w-sm"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

export default Toast;
