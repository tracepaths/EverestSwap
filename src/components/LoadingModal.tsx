import { createPortal } from 'react-dom';

interface LoadingModalProps {
  isOpen: boolean;
  title: string;
  steps: { key: string; label: string }[];
  currentStep: string;
  error?: string;
  done?: boolean;
  doneLabel?: string;
  onCancel?: () => void;
  onClose?: () => void;
}

export default function LoadingModal({
  isOpen,
  title,
  steps,
  currentStep,
  error,
  done,
  doneLabel,
  onCancel,
  onClose,
}: LoadingModalProps) {
  if (!isOpen) return null;

  const currentIdx = steps.findIndex(s => s.key === currentStep);
  const progressPct = done ? 100 : currentIdx >= 0 ? ((currentIdx + 1) / steps.length) * 100 : 0;

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-[var(--app-panel)] rounded-2xl border border-[var(--app-border)] max-w-md w-full mx-4 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-[var(--app-text)]">{done ? 'Completed' : title}</h3>
            {!done && !error && (
              <span className="text-xs font-mono text-[var(--app-muted)]">
                Step {currentIdx + 1}/{steps.length}
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {!done && !error && (
          <div className="px-6 py-3">
            <div className="h-2 bg-[var(--app-bg)] rounded-full overflow-hidden border border-[var(--app-border)]">
              <div
                className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Step checklist */}
        {!error && (
          <div className="px-6 pb-4 space-y-1">
            {steps.map((def, idx) => {
              const isDone = done || idx < currentIdx;
              const isCurrent = !done && idx === currentIdx;

              return (
                <div
                  key={def.key}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isCurrent ? 'bg-[var(--app-blue)]/10 text-[var(--app-blue-3)]' :
                    isDone ? 'text-[var(--app-success)]' :
                    'text-[var(--app-muted)]'
                  }`}
                >
                  {isDone ? (
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isCurrent ? (
                    <div className="w-4 h-4 flex-shrink-0 border-2 border-[var(--app-blue)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <div className="w-4 h-4 flex-shrink-0 rounded-full border border-[var(--app-border)]" />
                  )}
                  <span className="font-medium">{idx + 1}. {def.label}</span>
                  {isCurrent && (
                    <span className="ml-auto text-[10px] text-[var(--app-muted)]">sign...</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-6 pb-4">
            <div className="text-sm text-[var(--app-danger)] bg-red-400/10 rounded-lg px-4 py-3">
              {error}
            </div>
          </div>
        )}

        {/* Done content slot */}
        {done && doneLabel && (
          <div className="px-6 pb-4">
            <div className="text-sm text-[var(--app-success)] bg-green-400/10 rounded-lg px-4 py-3 flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {doneLabel}
            </div>
          </div>
        )}

        {/* Footer buttons */}
        <div className="px-6 pb-6 flex gap-3">
          {(done || error) && onClose && (
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] rounded-xl font-medium text-sm hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] transition-colors"
            >
              {error ? 'Try Again' : 'Done'}
            </button>
          )}
          {!done && !error && onCancel && (
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl font-medium text-sm hover:bg-[var(--app-hover)] transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
