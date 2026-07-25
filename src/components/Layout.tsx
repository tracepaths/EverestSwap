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
  { path: '/dashboard', label: 'Portfolio', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { path: '/liquidity', label: 'Liquidity', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { path: '/pool', label: 'Pool', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  { path: '/launch', label: 'Launch', icon: 'M15.59 14.37a6 6 0 00-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311-.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z' },
];

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

  // Try to parse message as JSON array to get contract call parameters
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

  // If method name is empty, guess from parameter type and destination contract address
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

  // Additional fallback if array containing 2 numbers is detected but method is unknown
  if (isJsonArray && args.length === 2 && !isNaN(Number(args[0])) && !isNaN(Number(args[1]))) {
    return `Swap ${formatAmount(String(args[0]))} tokens`;
  }

  // If message format is plain text (not JSON), return directly
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    setMobileMenuOpen(false);
  }, [location.pathname]);

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
    <div className="min-h-screen h-screen flex flex-col text-[var(--app-text)] relative app-shell" style={{ zIndex: 1 }}>
      <SnowEffect />
      <header className="sticky top-0 z-30 border-b border-[var(--app-border)] bg-[var(--app-bg)]/75 backdrop-blur-2xl shadow-lg shadow-black/10">
        <div className="mx-auto w-full max-w-[1440px] px-3 sm:px-5 lg:px-8">
          <div className="flex min-h-[68px] flex-wrap items-center gap-3 py-2 sm:gap-5">
            <Link to="/" className="group flex shrink-0 items-center gap-2.5" aria-label="EverestSwap home">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--app-blue-2)]/30 bg-[var(--app-blue)]/15 shadow-lg shadow-[var(--app-shadow)] transition-transform group-hover:-translate-y-0.5">
                <svg className="h-7 w-7" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                  <path d="M22 10 14 26h16L22 10Z" fill="url(#logo-lhotse)" opacity=".7" />
                  <path d="M12 4 2 26h20L12 4Z" fill="url(#logo-everest)" />
                  <path d="m12 4-3.5 7.5L12 10l2.5 1.5L12 4Z" fill="#fff" opacity=".95" />
                  <path d="M6 22c4-2 14-2 18 0M20 25c-4 2-12 2-16 0" stroke="#fff" strokeWidth="1.35" strokeLinecap="round" />
                  <defs><linearGradient id="logo-everest" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#93C5FD" /><stop offset="1" stopColor="#2563EB" /></linearGradient><linearGradient id="logo-lhotse" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#BFDBFE" /><stop offset="1" stopColor="#1D4ED8" /></linearGradient></defs>
                </svg>
              </span>
              <span className="hidden sm:block text-[15px] font-extrabold tracking-tight text-[var(--app-text)]">Everest<span className="text-[var(--app-blue-2)]">Swap</span></span>
            </Link>

            <nav className="hidden min-w-0 flex-1 overflow-x-auto pb-0.5 [scrollbar-width:none] lg:flex" aria-label="Main navigation">
              <div className="flex min-w-max items-center gap-1 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-panel-soft-2)] p-1">
                {navItems.map(item => {
                  const isActive = location.pathname === item.path;
                  return <Link key={item.path} to={item.path} className={`flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-xs font-bold transition-all sm:px-3.5 sm:text-sm ${isActive ? 'bg-[var(--app-blue)] text-white shadow-md shadow-[var(--app-shadow)]' : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'}`}>
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={item.icon} /></svg>
                    {item.label}
                  </Link>;
                })}
                <Link to="/docs" className={`flex min-h-10 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-xs font-bold transition-all sm:px-3.5 sm:text-sm ${location.pathname === '/docs' ? 'bg-[var(--app-blue)] text-white shadow-md shadow-[var(--app-shadow)]' : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'}`}>
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18 5.754 18 7.5 18s3.332 0 4.5 1.253m0-13C13.168 5 14.754 5 16.5 5c1.747 0 3.332 0 4.5 1.253v13C19.832 18 18.247 18 16.5 18c-1.746 0-3.332 1.253-4.5 1.253" /></svg>
                  Docs
                </Link>
              </div>
            </nav>

            <div ref={controlsRef} className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <div className="relative">
                <button onClick={() => toggleMenu('network')} className="topbar-control" aria-label="Select network"><span className="status-dot" /> <span className="hidden xl:inline">{network}</span><span className="xl:hidden">{network === 'mainnet' ? 'Main' : 'Dev'}</span><svg className="h-3.5 w-3.5 text-[var(--app-muted-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" /></svg></button>
                {openMenu === 'network' && <div className="header-menu"><div className="menu-heading">Network</div>{networks.map(item => <button key={item.value} onClick={() => handleNetworkSelect(item.value as 'devnet' | 'mainnet')} className={`menu-option ${network === item.value ? 'menu-option-active' : ''}`}>{item.label}{!MAINNET_CONFIGURED && item.value === 'mainnet' && <span className="text-[10px] text-[var(--app-warning)]">Soon</span>}</button>)}</div>}
              </div>
              <div className="relative hidden sm:block">
                <button onClick={() => toggleMenu('theme')} className="topbar-control" aria-label="Select theme"><span className="text-[var(--app-muted)]">◐</span><span className="hidden lg:inline capitalize">{theme}</span><svg className="h-3.5 w-3.5 text-[var(--app-muted-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" /></svg></button>
                {openMenu === 'theme' && <div className="header-menu"><div className="menu-heading">Appearance</div>{themes.map(item => <button key={item.value} onClick={() => { setTheme(item.value as 'dark' | 'light' | 'blue'); setOpenMenu(null); }} className={`menu-option ${theme === item.value ? 'menu-option-active' : ''}`}>{item.label}{theme === item.value && <span>✓</span>}</button>)}</div>}
              </div>
              <div className="relative hidden md:block">
                <button onClick={() => toggleMenu('activity')} className="topbar-control" aria-label="Open activity"><span className="text-[var(--app-muted)]">◷</span><span className="hidden lg:inline">Activity</span><span className="text-[var(--app-text)]">{isConnected ? activity.length : 0}</span><svg className="h-3.5 w-3.5 text-[var(--app-muted-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" /></svg></button>
                {openMenu === 'activity' && <div className="header-menu w-80 max-w-[calc(100vw-1.5rem)]"><div className="border-b border-[var(--app-border)] px-4 py-3"><div className="flex items-center justify-between text-sm font-bold"><span>Recent Activity</span><span className="text-[10px] text-[var(--app-muted-2)]">Last 10</span></div><div className="mt-1 text-xs text-[var(--app-muted-2)]">{isConnected ? 'Latest wallet transactions' : 'Connect wallet to view activity'}</div></div><div className="max-h-96 space-y-1 overflow-y-auto p-2">{activityLoading ? [1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-[var(--app-panel-soft)]" />) : activity.length === 0 ? <div className="py-8 text-center text-xs text-[var(--app-muted)]">{isConnected ? 'No activity found' : 'Connect wallet to view recent activity'}</div> : activity.map(item => <div key={item.hash} className="rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-3"><div className="flex items-center justify-between gap-3"><div className="truncate text-xs font-semibold">{item.label}</div><span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] capitalize ${statusClass(item.status)}`}>{item.status}</span></div><div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-[var(--app-muted-2)]"><span className="truncate font-mono">{truncateAddress(item.hash, 8, 6)}</span><div className="flex shrink-0 items-center gap-2"><span>{item.time}</span><a href={getExplorerTxUrl(item.hash)} target="_blank" rel="noopener noreferrer" className="text-[var(--app-blue-3)] hover:underline">View TX →</a></div></div></div>)}</div></div>}
              </div>
              <WalletConnector />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(value => !value)}
                className="mobile-menu-button lg:hidden"
                aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" /></svg>
                )}
              </button>
            </div>
          </div>
          {mobileMenuOpen && (
            <div className="mobile-menu-panel lg:hidden">
              <div className="mobile-menu-heading">Navigate</div>
              <div className="grid grid-cols-2 gap-2">
                {navItems.map(item => {
                  const isActive = location.pathname === item.path;
                  return <Link key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)} className={`mobile-menu-link ${isActive ? 'mobile-menu-link-active' : ''}`}>
                    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d={item.icon} /></svg>
                    {item.label}
                  </Link>;
                })}
                <Link to="/docs" onClick={() => setMobileMenuOpen(false)} className={`mobile-menu-link ${location.pathname === '/docs' ? 'mobile-menu-link-active' : ''}`}>
                  <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18 5.754 18 7.5 18s3.332 0 4.5 1.253m0-13C13.168 5 14.754 5 16.5 5c1.747 0 3.332 0 4.5 1.253v13C19.832 18 18.247 18 16.5 18c-1.746 0 3.332 0 4.5 1.253" /></svg>
                  Docs
                </Link>
              </div>
            </div>
          )}
        </div>
      </header>
      <main className="relative min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8 safe-bottom">
        <div className="mx-auto w-full max-w-[1440px]"><Outlet /></div>
      </main>
      <ToastContainer />
    </div>
  );

}

export default Layout;
