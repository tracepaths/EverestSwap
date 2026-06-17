import { useState, useRef, useEffect } from 'react';
import { useApp } from '../contexts/AppContext';
import { truncateAddress } from '../services/swapService';
// [V7-PASS9] M-13: import shared formatter
import { formatOctBalance } from '../utils/format';

function WalletConnector() {
  const { isConnected, walletAddress, walletBalance, isWalletInstalled, connect, disconnect, refreshBalance } = useApp();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // [V7-FIX] Refresh balance every 10s while connected so it stays current
  // after wraps, swaps, etc.
  useEffect(() => {
    if (!isConnected) return;
    const i = setInterval(() => { refreshBalance().catch(() => {}); }, 10000);
    return () => clearInterval(i);
  }, [isConnected, refreshBalance]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (isConnected) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(prev => !prev)}
          className="flex items-center gap-2 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] backdrop-blur-xl px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="hidden sm:inline">{truncateAddress(walletAddress)}</span>
          <span className="text-xs text-[var(--app-muted)]">
            {/* [V7-FIX] Adaptive formatting — use 6 decimals for sub-0.01 OCT to
                show actual balance, 2 decimals otherwise */}
            {walletBalance ? formatOctBalance(walletBalance) : ''}
          </span>
        </button>
        {dropdownOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/70 backdrop-blur-xl z-40"
              onClick={() => setDropdownOpen(false)}
            />
            <div className="absolute right-0 mt-2 w-56 bg-[var(--app-dropdown-bg)] border border-[var(--app-border)] rounded-xl shadow-xl overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-[var(--app-border)]">
                <div className="text-xs text-[var(--app-muted)]">Connected</div>
                <div className="text-sm font-medium mt-0.5 font-mono">{truncateAddress(walletAddress, 10, 8)}</div>
              </div>
              {walletBalance && (
                <div className="px-4 py-2 border-b border-[var(--app-border)]">
                  <div className="text-xs text-[var(--app-muted)]">Balance</div>
                  <div className="text-sm font-medium">{formatOctBalance(walletBalance, 6)}</div>
                </div>
              )}
              <button
                onClick={() => {
                  // [V7-FIX] Wrap disconnect in try/catch — if user uninstalled
                  // the extension or the call fails, still close the dropdown.
                  try { disconnect(); } catch { /* noop */ }
                  setDropdownOpen(false);
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-[var(--app-danger)] hover:bg-[var(--app-panel)] transition-colors"
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={async () => {
        setConnecting(true);
        try {
          await connect();
        } catch {
          // silently fail
        } finally {
          setConnecting(false);
        }
      }}
      disabled={connecting}
      className="flex items-center gap-2 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:opacity-50 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
    >
      {isWalletInstalled && (
        <span className="w-2 h-2 rounded-full bg-green-400" />
      )}
      {connecting ? 'Connecting...' : 'Connect Wallet'}
    </button>
  );
}

export default WalletConnector;
