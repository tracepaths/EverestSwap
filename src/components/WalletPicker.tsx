import { useEffect, useRef } from 'react';
import type { WalletKind } from '../services/walletService';

interface WalletOption {
  kind: WalletKind;
  name: string;
  tagline: string;
  icon: string;
  /** Shown instead of the tagline when the wallet cannot be used right now. */
  unavailableReason?: string;
  installUrl?: string;
}

interface WalletPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (kind: WalletKind) => void;
  /** Whether the 0xio extension is present in this browser. */
  has0xio: boolean;
  /** Kind currently being connected, if any (shows a spinner). */
  connecting: WalletKind | null;
}

export default function WalletPicker({
  open,
  onClose,
  onSelect,
  has0xio,
  connecting,
}: WalletPickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  const options: WalletOption[] = [
    {
      kind: '0xio',
      name: '0xio Wallet',
      tagline: 'Browser extension',
      icon: '🧩',
      unavailableReason: has0xio ? undefined : 'Not installed',
      installUrl: 'https://0xio.xyz',
    },
    {
      kind: 'orion',
      name: 'Orion Wallet',
      tagline: 'Web wallet — opens in a popup',
      icon: '🪐',
    },
  ];

  // Close on Escape and trap initial focus, so the dialog is usable by
  // keyboard and screen readers rather than mouse-only.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    firstButtonRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-picker-title"
        className="w-[min(92vw,26rem)] rounded-2xl border border-[var(--app-border)] bg-[var(--app-dropdown-bg)] p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-1">
          <h2 id="wallet-picker-title" className="text-lg font-semibold text-[var(--app-text)]">
            Connect a wallet
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--app-muted-2)] hover:text-[var(--app-text)] transition-colors p-1 rounded-lg"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-[var(--app-muted-2)] mb-4">
          Choose how you want to sign transactions on EverestSwap.
        </p>

        <div className="flex flex-col gap-2">
          {options.map((opt, i) => {
            const unavailable = !!opt.unavailableReason;
            const isConnecting = connecting === opt.kind;
            const disabled = unavailable || connecting !== null;

            if (unavailable && opt.installUrl) {
              return (
                <a
                  key={opt.kind}
                  href={opt.installUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-xl border border-[var(--app-border)] hover:border-[var(--app-blue)] bg-[var(--app-panel-soft)] transition-all group"
                >
                  <span className="text-2xl" aria-hidden="true">{opt.icon}</span>
                  <span className="flex-1 min-w-0 text-left">
                    <span className="block text-sm font-medium text-[var(--app-text)]">{opt.name}</span>
                    <span className="block text-xs text-[var(--app-muted-2)]">
                      {opt.unavailableReason} — install ↗
                    </span>
                  </span>
                </a>
              );
            }

            return (
              <button
                key={opt.kind}
                ref={i === 0 ? firstButtonRef : undefined}
                onClick={() => onSelect(opt.kind)}
                disabled={disabled}
                aria-busy={isConnecting}
                className="flex items-center gap-3 p-3 rounded-xl border border-[var(--app-border)] hover:border-[var(--app-blue)] bg-[var(--app-panel-soft)] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                <span className="text-2xl" aria-hidden="true">{opt.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-[var(--app-text)]">{opt.name}</span>
                  <span className="block text-xs text-[var(--app-muted-2)]">{opt.tagline}</span>
                </span>
                {isConnecting && (
                  <span
                    className="w-4 h-4 rounded-full border-2 border-[var(--app-blue)] border-t-transparent animate-spin"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-[var(--app-muted-2)]">
          Orion opens a popup to sign — allow popups for this site. It signs only;
          EverestSwap submits the transaction.
        </p>
      </div>
    </div>
  );
}
