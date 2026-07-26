import type { MyPool, RemoveStep } from '../utils/poolUtils';
import { isPoolRemovable } from '../utils/poolUtils';
import { useState } from 'react';

interface RemovePoolModalProps {
  pool: MyPool;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (confirmText: string) => Promise<RemoveStep>;
  removeStep: RemoveStep;
}

export default function RemovePoolModal({
  pool,
  isOpen,
  onClose,
  onConfirm,
  removeStep,
}: RemovePoolModalProps) {
  const [confirmText, setConfirmText] = useState('');
  if (!isOpen || !pool) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[var(--app-panel)] border border-red-900/60 rounded-2xl w-full max-w-md shadow-2xl shadow-black/50">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-[var(--app-border-soft)]">
          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-[var(--app-text)]">Remove Pool</h3>
            <p className="text-xs text-[var(--app-muted)]">Deregister from SwapFactory — irreversible</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-[var(--app-muted)]">Pool</span>
              <span className="font-mono text-[var(--app-text)] text-xs">{pool.address.slice(0, 10)}...{pool.address.slice(-6)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--app-muted)]">Pair</span>
              <span className="font-bold text-[var(--app-text)]">{pool.symbolA} / {pool.symbolB}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--app-muted)]">Removable</span>
              <span className={`font-bold ${isPoolRemovable(pool) ? 'text-green-400' : 'text-red-400'}`}>{isPoolRemovable(pool) ? 'Yes' : 'No'}</span>
            </div>
          </div>

          <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-3 text-xs text-red-200/70 leading-relaxed">
            ⚠️ This action permanently removes the pool from the factory routing. The pool contract remains on-chain but cannot be used for swaps. This cannot be undone.
          </div>

          <div className="space-y-2">
            <label className="text-xs text-[var(--app-muted)] font-medium">
              Type <span className="font-mono font-bold text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">REMOVE</span> to confirm:
            </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type REMOVE here…"
                  className="w-full bg-[var(--app-input)] border border-[var(--app-border)] text-[var(--app-text)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-red-500/60 transition-colors"
                />
          </div>

          {removeStep.type === 'error' && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3">
              {removeStep.message}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={() => { setConfirmText(''); onClose(); }}
            disabled={removeStep.type === 'pending'}
            className="flex-1 px-4 py-2.5 bg-[var(--app-panel-soft)] hover:bg-[var(--app-hover)] text-[var(--app-text)] font-semibold rounded-xl transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm('REMOVE')}
            disabled={removeStep.type === 'pending'}
            className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {removeStep.type === 'pending' ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Removing…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Remove Pool
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
