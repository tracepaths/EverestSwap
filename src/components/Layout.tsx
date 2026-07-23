import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import WalletConnector from './WalletConnector';
import ToastContainer from './Toast';
import { SnowEffect } from './SnowEffect';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { truncateAddress } from '../services/swapService';
// [V7-FIX] Import env-based explorer URL config
import { CONTRACTS, MAINNET_CONFIGURED, buildExplorerTxUrl } from '../config';

const navItems = [
  { path: '/', label: 'Swap', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
  { path: '/liquidity', label: 'Liquidity', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { path: '/pool', label: 'Pool', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  { path: '/launch', label: 'Launch', icon: 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z' },];

const networks = [
  { value: 'devnet', label: 'Devnet' },
  { value: 'mainnet', label: 'Mainnet' },
];

const themes = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'blue', label: 'Blue' },
];

type HeaderMenu = 'network' | 'theme' | 'activity' | null;

// [V7-FIX] Get explorer URL using env-based config.
// Honors either "/tx.html?hash={hash}" (Octra) or "/tx/" (legacy) path
// templates via buildExplorerTxUrl.
function getExplorerTxUrl(hash: string): string {
  return buildExplorerTxUrl(hash);
}

interface ActivityItem {
  hash: string;
  status: string;
  time: string;
  label: string;
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp * 1000;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

function statusClass(status: string): string {
  if (status === 'confirmed' || status === 'success') return 'text-[var(--app-success)] bg-[var(--app-success)]/10 border-[var(--app-success)]/20';
  if (status === 'pending') return 'text-[var(--app-warning)] bg-[var(--app-warning)]/10 border-[var(--app-warning)]/20';
  return 'text-[var(--app-danger)] bg-[var(--app-danger)]/10 border-[var(--app-danger)]/20';
}

function getHumanReadableLabel(tx: { message?: string; encrypted_data?: string; method?: string; amount?: string | number; to_?: string; to?: string; hash?: string }): string {
  // [SECURITY] F-2: Sanitize message before processing — strip zero-width / RTL / control chars
  // to prevent homoglyph attacks via the activity panel
  const rawMsg = String(tx.message || '').slice(0, 2000);
  const msg = sanitizeLabel(rawMsg).trim();

  // [SECURITY] F-2: Limit message length to prevent DoS / injection
  const methodRaw = (tx.encrypted_data || tx.method || '').toString().slice(0, 64);
  const method = methodRaw.toLowerCase();
  const amount = String(tx.amount || '0').slice(0, 50);
  const toRaw = (tx.to_ || tx.to || '').toString().slice(0, 64);
  const to = toRaw.toLowerCase();

  // Coba parse message sebagai JSON array untuk mendapatkan parameter panggilan kontrak
  let args: unknown[] = [];
  let isJsonArray = false;
  if (msg.startsWith('[') && msg.endsWith(']')) {
    try {
      args = JSON.parse(msg) as unknown[];
      // [SECURITY] FM-8: Cap args to 10 elements, each to 200 chars to prevent
      // abuse via huge JSON arrays in transaction messages
      if (Array.isArray(args)) {
        args = args.slice(0, 10).map(a => {
          if (typeof a === 'string') return a.slice(0, 200);
          if (typeof a === 'number') return String(a).slice(0, 50);
          return '';
        });
      }
      isJsonArray = Array.isArray(args);
    } catch { /* noop */ }
  }

  const formatAmount = (amt: string) => {
    // [SECURITY] F-2: Cap Number() to safe range to prevent Infinity/NaN in display
    let num = Number(amt);
    if (!Number.isFinite(num)) return '';
    num = Math.min(1e15, Math.max(-1e15, num));
    if (num === 0) return '';
    const formatted = num / 1000000; // 6 decimals
    return formatted.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  const amtStr = formatAmount(amount);

  // Jika nama method kosong, tebak dari tipe parameter dan alamat kontrak tujuan
  let inferredMethod = method;
  if (!inferredMethod && isJsonArray) {
    // [SECURITY] FM-3: Validate args are strings (not objects/arrays) before inferring
    const isString = (x: unknown): x is string => typeof x === 'string';
    const isNumericStr = (s: string) => /^\d+$/.test(s);
    if (args.length === 2 && isString(args[0]) && args[0].startsWith('oct') && isString(args[1]) && isNumericStr(args[1])) {
      inferredMethod = 'grant';
    } else if (args.length === 2 && isString(args[0]) && isNumericStr(args[0]) && isString(args[1]) && isNumericStr(args[1])) {
      inferredMethod = 'swap';
    } else if (args.length === 0) {
      if (to === CONTRACTS.woct.toLowerCase()) {
        inferredMethod = 'deposit';
      }
    } else if (args.length === 1 && isString(args[0]) && isNumericStr(args[0])) {
      if (to === CONTRACTS.woct.toLowerCase()) {
        inferredMethod = 'withdraw';
      }
    }
  }

  if (inferredMethod === 'deposit') {
    return amtStr ? `Wrap ${amtStr} OCT` : 'Wrap OCT';
  }
  if (inferredMethod === 'withdraw') {
    let parsedAmt = '';
    if (args && args.length > 0) {
      parsedAmt = formatAmount(String(args[0]));
    }
    return parsedAmt ? `Unwrap ${parsedAmt} WOCT` : 'Unwrap WOCT';
  }
  if (inferredMethod === 'grant') {
    let spender = '';
    let grantAmt = '';
    if (args && args.length > 0) spender = sanitizeLabel(String(args[0]).slice(0, 50));
    if (args && args.length > 1) grantAmt = formatAmount(String(args[1]));

    let spenderName: string;
    const spenderAddr = spender.toLowerCase();
    if (spenderAddr === CONTRACTS.router.toLowerCase()) spenderName = 'Router';
    else if (spenderAddr === CONTRACTS.pool.toLowerCase()) spenderName = 'Pool';
    else if (spenderAddr === CONTRACTS.woct.toLowerCase()) spenderName = 'WOCT';
    else spenderName = spender.substring(0, 8) + '...';

    return sanitizeLabel(`Approve ${spenderName} (${grantAmt || 'Unlimited'})`).slice(0, 80);
  }
  if (inferredMethod === 'swap' || inferredMethod === 'swap_a_for_b' || inferredMethod === 'swap_b_for_a' || inferredMethod === 'swap_exact_tokens_for_tokens') {
    let parsedAmt = '';
    if (args && args.length > 0) {
      parsedAmt = formatAmount(String(args[0]));
    }

    let pair = '';
    if (inferredMethod === 'swap_a_for_b') pair = ' (WOCT → OES)';
    else if (inferredMethod === 'swap_b_for_a') pair = ' (OES → WOCT)';

    return `Swap ${parsedAmt || amtStr || ''}${pair}`;
  }

  if (inferredMethod === 'add_liquidity') return 'Add Liquidity';
  if (inferredMethod === 'remove_liquidity') return 'Remove Liquidity';
  if (inferredMethod === 'close_position') return 'Remove All Liquidity';
  if (inferredMethod) {
    return sanitizeLabel(inferredMethod.charAt(0).toUpperCase() + inferredMethod.slice(1).replace(/_/g, ' ')).slice(0, 80);
  }

  // Fallback tambahan jika terdeteksi array berisi 2 angka tetapi metode tidak diketahui
  if (isJsonArray && args.length === 2 && !isNaN(Number(args[0])) && !isNaN(Number(args[1]))) {
    return `Swap ${formatAmount(String(args[0]))} tokens`;
  }

  // Jika format pesan berupa teks biasa (bukan JSON), kembalikan langsung
  if (msg && !msg.startsWith('[') && !msg.startsWith('{')) {
    return sanitizeLabel(msg).slice(0, 80);
  }

  if (amount !== '0' && amount !== '') {
    return sanitizeLabel(`Transfer ${amtStr || amount}`).slice(0, 80);
  }

  return tx.hash ? `Transaction ${tx.hash.substring(0, 8)}...` : 'Unknown Action';
}

// [SECURITY] F-2: Strip zero-width / RTL / control characters from text shown to user
function sanitizeLabel(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u0000-\u001F\u007F]/g, '');
}

function Layout() {
  const { network, setNetwork, theme, setTheme, isConnected } = useApp();
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState<HeaderMenu>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (controlsRef.current && !controlsRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isConnected) {
      setActivity([]);
      return;
    }

    let mounted = true;
    const loadActivity = () => {
      if (!mounted) return;
      setActivityLoading(true);
      walletService.getTransactionHistory(1, 10)
        .then(history => {
          if (!mounted) return;
          // [SECURITY] F-3: Wrap getHumanReadableLabel in try/catch per-item so a single
          // bad transaction doesn't clear the entire activity list
          const items = history.transactions.slice(0, 10).map(tx => {
            let label: string;
            try {
              label = getHumanReadableLabel(tx);
            } catch {
              // Fallback to a safe default label on parse failure
              label = tx.hash ? `Transaction ${tx.hash.substring(0, 8)}...` : 'Unknown Action';
            }
            return {
              hash: tx.hash,
              status: tx.status,
              time: formatTime(tx.timestamp),
              label,
            };
          });
          setActivity(items);
        })
        .catch(() => setActivity([]))
        .finally(() => {
          if (mounted) setActivityLoading(false);
        });
    };
    loadActivity();
    // [SECURITY] FM-1: Refresh activity every 30s so the user sees new transactions
    const interval = setInterval(loadActivity, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
    // [V7-FIX] Re-run when network changes to clear stale activity from other network
  }, [isConnected, network]);

  function toggleMenu(menu: HeaderMenu) {
    setOpenMenu(openMenu === menu ? null : menu);
  }

  function handleNetworkSelect(n: 'devnet' | 'mainnet') {
    try {
      setNetwork(n);
    } catch {
      console.warn('Network switch failed');
    } finally {
      setOpenMenu(null);
    }
  }

  return (
    <div className="h-screen flex text-[var(--app-text)] relative app-shell" style={{ zIndex: 1 }}>
      <SnowEffect />
      <div className="flex-1 flex flex-col h-screen min-w-0">
        <header className="sticky top-0 z-20 app-topbar backdrop-blur-2xl border-b border-[var(--app-border)]">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 lg:gap-5 px-3 sm:px-4 lg:px-8 py-2.5 sm:py-3">
            <Link to="/" className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0" aria-label="EverestSwap home">
              <div className="token-orb w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--app-blue-2)] to-[var(--app-blue)] flex items-center justify-center text-[#07131d] font-extrabold">E</div>
              <div className="hidden sm:block">
                <div className="text-sm sm:text-base font-extrabold tracking-tight">Everest<span className="text-[var(--app-blue-2)]">Swap</span></div>
                <div className="eyebrow text-[8px] text-[var(--app-muted-2)]">Octra exchange</div>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-1 min-w-0 overflow-x-auto" aria-label="Primary navigation">
              {navItems.map(item => <Link key={item.path} to={item.path} className={`px-2.5 lg:px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${location.pathname === item.path ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)]' : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'}`}>{item.label}</Link>)}
            </nav>

            <div ref={controlsRef} className="flex items-center justify-end gap-1.5 sm:gap-2 lg:gap-3 ml-auto shrink-0">
              <div className="relative">
                <button onClick={() => toggleMenu('network')} className="hidden sm:flex items-center gap-2 bg-[var(--app-panel-soft-2)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-xs font-semibold transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--app-success)] shadow-[0_0_8px_var(--app-success)]" />
                  <span className="text-[var(--app-text)] capitalize">{network}</span>
                  <svg className="w-3.5 h-3.5 text-[var(--app-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </button>
                {openMenu === 'network' && (
                  <div className="absolute right-0 top-full mt-2 w-40 bg-[var(--app-dropdown-bg)] border border-[var(--app-border)] rounded-xl shadow-xl overflow-hidden z-50">
                    {networks.map(item => <button key={item.value} onClick={() => handleNetworkSelect(item.value as 'devnet' | 'mainnet')} className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${network === item.value ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)]' : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'}`}>{item.label}{!MAINNET_CONFIGURED && item.value === 'mainnet' && <span className="text-[10px] text-[var(--app-warning)]">not configured</span>}</button>)}
                  </div>
                )}
              </div>

              <div className="relative hidden lg:block">
                <button onClick={() => toggleMenu('theme')} className="flex items-center gap-2 bg-[var(--app-panel-soft-2)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-xs font-semibold transition-colors"><span className="text-[var(--app-muted-2)]">Theme</span><span className="text-[var(--app-text)] capitalize">{theme}</span><svg className="w-3.5 h-3.5 text-[var(--app-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></button>
                {openMenu === 'theme' && <div className="absolute right-0 top-full mt-2 w-36 bg-[var(--app-dropdown-bg)] border border-[var(--app-border)] rounded-xl shadow-xl overflow-hidden z-50">{themes.map(item => <button key={item.value} onClick={() => { setTheme(item.value as 'dark' | 'light' | 'blue'); setOpenMenu(null); }} className={`w-full flex items-center justify-between px-4 py-2.5 text-sm ${theme === item.value ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)]' : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)]'}`}>{item.label}</button>)}</div>}
              </div>

              <div className="relative hidden sm:block">
                <button onClick={() => toggleMenu('activity')} className="flex items-center gap-2 bg-[var(--app-panel-soft-2)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-xs font-semibold transition-colors"><span className="text-[var(--app-muted-2)]">Activity</span><span className="text-[var(--app-text)]">{isConnected ? activity.length : 0}</span><svg className="w-3.5 h-3.5 text-[var(--app-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg></button>
                {openMenu === 'activity' && (
                  <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-[var(--app-dropdown-bg)] border border-[var(--app-border)] rounded-xl shadow-xl overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-[var(--app-border)]">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">Recent Activity</div>
                        <div className="text-[10px] text-[var(--app-muted-2)]">Last 10</div>
                      </div>
                      <div className="text-xs text-[var(--app-muted-2)] mt-1">
                        {isConnected ? 'Latest wallet transactions' : 'Connect wallet to view activity'}
                      </div>
                    </div>
                    <div className="max-h-96 overflow-y-auto p-2 space-y-1">
                      {activityLoading ? (
                        [1, 2, 3].map(i => (
                          <div key={i} className="h-14 bg-[var(--app-panel-soft)] rounded-xl animate-pulse" />
                        ))
                      ) : activity.length === 0 ? (
                        <div className="text-center py-8 text-xs text-[var(--app-muted)]">
                          {isConnected ? 'No activity found' : 'Connect wallet to view recent activity'}
                        </div>
                      ) : (
                        activity.map(item => (
                          <div key={item.hash} className="rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium truncate">{item.label}</div>
                              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] capitalize ${statusClass(item.status)}`}>
                                {item.status}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3 mt-2 text-[10px] text-[var(--app-muted-2)]">
                              <span className="font-mono truncate">{truncateAddress(item.hash, 8, 6)}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span>{item.time}</span>
                                {/* [V7-FIX] View TX link to Octrascan explorer */}
                                <a
                                  href={getExplorerTxUrl(item.hash)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[var(--app-blue-3)] hover:text-[var(--app-blue)] hover:underline transition-colors"
                                  title="View transaction on explorer"
                                >
                                  View TX →
                                </a>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <WalletConnector />
            </div>
          </div>

          <nav className="md:hidden flex items-center gap-1 overflow-x-auto px-4 pb-3 scrollbar-none" aria-label="Mobile navigation">
            {navItems.map(item => <Link key={item.path} to={item.path} className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 ${location.pathname === item.path ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)]' : 'text-[var(--app-muted)]'}`}>{item.label}</Link>)}
          </nav>
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 lg:p-8 relative">
          <div className="max-w-[1440px] mx-auto w-full">
            <Outlet />
          </div>
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}

export default Layout;
