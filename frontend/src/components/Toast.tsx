import { useEffect } from 'react';
import { useApp } from '../contexts/AppContext';

const icons: Record<string, string> = {
  pending: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  error: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
};

const borderColors: Record<string, string> = {
  pending: 'border-l-[var(--app-blue)]',
  success: 'border-l-[var(--app-success)]',
  error: 'border-l-[var(--app-danger)]',
};

function ToastItem({ toast }: { toast: { id: string; type: string; message: string; txHash?: string } }) {
  const { removeToast } = useApp();

  useEffect(() => {
    if (toast.type !== 'pending') {
      const timer = setTimeout(() => removeToast(toast.id), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast, removeToast]);

  return (
    <div className={`bg-[var(--app-panel)] backdrop-blur-xl border border-[var(--app-border)] border-l-4 ${borderColors[toast.type] || 'border-l-gray-500'} rounded-xl px-4 py-3 shadow-lg flex items-start gap-3 min-w-[300px] max-w-md`}>
      <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d={icons[toast.type] || icons.pending} />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{toast.message}</div>
        {toast.txHash && (
          <div className="text-xs mt-1 text-[var(--app-text)]/70 font-mono truncate">{toast.txHash}</div>
        )}
      </div>
      <button onClick={() => removeToast(toast.id)} className="text-[var(--app-text)]/60 hover:text-[var(--app-text)] flex-shrink-0">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function ToastContainer() {
  const { toasts } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

export default ToastContainer;
