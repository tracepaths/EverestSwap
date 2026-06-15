import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import WalletConnector from './WalletConnector';
import ToastContainer from './Toast';
import { SnowEffect } from './SnowEffect';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { truncateAddress } from '../services/swapService';
import { CONTRACTS } from '../config';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { path: '/', label: 'Swap', icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
  { path: '/liquidity', label: 'Liquidity', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { path: '/pool', label: 'Pool', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  { path: '/launch', label: 'Launch', icon: 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z' },
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

function getHumanReadableLabel(tx: any): string {
  const msg = (tx.message || '').trim();

  // Coba parse message sebagai JSON array untuk mendapatkan parameter panggilan kontrak
  let args: any[] = [];
  let isJsonArray = false;
  if (msg.startsWith('[') && msg.endsWith(']')) {
    try {
      args = JSON.parse(msg);
      isJsonArray = Array.isArray(args);
    } catch {}
  }

  const method = (tx.encrypted_data || tx.method || '').toLowerCase();
  const amount = tx.amount || '0';
  const to = (tx.to_ || tx.to || '').toLowerCase();

  const formatAmount = (amt: string) => {
    const num = Number(amt);
    if (isNaN(num) || num === 0) return '';
    const formatted = num / 1000000; // 6 decimals
    return formatted.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  const amtStr = formatAmount(amount);

  // Jika nama method kosong, tebak dari tipe parameter dan alamat kontrak tujuan
  let inferredMethod = method;
  if (!inferredMethod && isJsonArray) {
    if (args.length === 2 && args[0].startsWith('oct') && typeof args[1] === 'string' && !isNaN(Number(args[1]))) {
      inferredMethod = 'grant';
    } else if (args.length === 2 && !isNaN(Number(args[0])) && !isNaN(Number(args[1]))) {
      inferredMethod = 'swap';
    } else if (args.length === 0) {
      if (to === CONTRACTS.woct.toLowerCase()) {
        inferredMethod = 'deposit';
      }
    } else if (args.length === 1 && !isNaN(Number(args[0]))) {
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
    if (args && args.length > 0) spender = String(args[0]);
    if (args && args.length > 1) grantAmt = formatAmount(String(args[1]));

    let spenderName = 'Contract';
    const spenderAddr = spender.toLowerCase();
    if (spenderAddr === CONTRACTS.router.toLowerCase()) spenderName = 'Router';
    else if (spenderAddr === CONTRACTS.pool.toLowerCase()) spenderName = 'Pool';
    else if (spenderAddr === CONTRACTS.woct.toLowerCase()) spenderName = 'WOCT';
    else spenderName = spender.substring(0, 8) + '...';

    return `Approve ${spenderName} (${grantAmt || 'Unlimited'})`;
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
    return inferredMethod.charAt(0).toUpperCase() + inferredMethod.slice(1).replace(/_/g, ' ');
  }

  // Fallback tambahan jika terdeteksi array berisi 2 angka tetapi metode tidak diketahui
  if (isJsonArray && args.length === 2 && !isNaN(Number(args[0])) && !isNaN(Number(args[1]))) {
    return `Swap ${formatAmount(String(args[0]))} tokens`;
  }

  // Jika format pesan berupa teks biasa (bukan JSON), kembalikan langsung
  if (msg && !msg.startsWith('[') && !msg.startsWith('{')) {
    return msg;
  }

  if (amount !== '0' && amount !== '') {
    return `Transfer ${amtStr || amount}`;
  }

  return tx.hash ? `Transaction ${tx.hash.substring(0, 8)}...` : 'Unknown Action';
}

function Layout() {
  const { network, setNetwork, theme, setTheme, isConnected } = useApp();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    setActivityLoading(true);
    walletService.getTransactionHistory(1, 10)
      .then(history => {
        if (!mounted) return;
        const items = history.transactions.slice(0, 10).map(tx => ({
          hash: tx.hash,
          status: tx.status,
          time: formatTime(tx.timestamp),
          label: getHumanReadableLabel(tx),
        }));
        setActivity(items);
      })
      .catch(() => setActivity([]))
      .finally(() => {
        if (mounted) setActivityLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [isConnected]);

  function toggleMenu(menu: HeaderMenu) {
    setOpenMenu(openMenu === menu ? null : menu);
  }

  return (
    <div className="h-screen flex text-[var(--app-text)] relative" style={{ zIndex: 1 }}>
      <SnowEffect />
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[var(--app-panel)] backdrop-blur-2xl border-r border-[var(--app-border)] transform transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:inset-auto flex flex-col ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 px-6 py-5 border-b border-[var(--app-border)]">
          <div className="w-8 h-8 flex items-center justify-center relative">
            <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="logo-everest" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#60A5FA" />
                  <stop offset="100%" stopColor="#3B82F6" />
                </linearGradient>
                <linearGradient id="logo-lhotse" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#93C5FD" />
                  <stop offset="100%" stopColor="#1D4ED8" />
                </linearGradient>
              </defs>
              {/* Back mountain peak */}
              <path d="M22 10 L14 26 H30 Z" fill="url(#logo-lhotse)" opacity="0.6" />
              {/* Main Everest peak */}
              <path d="M12 4 L2 26 H22 Z" fill="url(#logo-everest)" />
              {/* Snow cap on Everest */}
              <path d="M12 4 L8.5 11.5 L12 10 L14.5 11.5 Z" fill="#FFFFFF" opacity="0.9" />
              {/* Swap curved arrows at bottom */}
              <path d="M6 22 C 10 20, 20 20, 24 22" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M24 22 L21 19.5 M24 22 L21 24.5" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20 25 C 16 27, 8 27, 4 25" stroke="#93C5FD" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M4 25 L7 27.5 M4 25 L7 22.5" stroke="#93C5FD" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-[var(--app-blue-2)] to-[var(--app-text)] bg-clip-text text-transparent">
            EverestSwap
          </span>
        </div>
        <nav className="mt-4 px-3 space-y-1 flex-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)] shadow-sm shadow-[var(--app-shadow)]'
                    : 'text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-hover)]'
                }`}
              >
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-4 border-t border-[var(--app-border)] space-y-2">
          <Link
            to="/docs"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-[var(--app-muted-2)] hover:text-[var(--app-blue-3)] hover:bg-[var(--app-hover)] transition-all duration-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Documentation
          </Link>
          <div className="text-[10px] text-[var(--app-muted-2)] px-3">EverestSwap v1.0.0</div>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-xl z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col h-screen min-w-0">
        <header className="sticky top-0 z-20 bg-[var(--app-panel)]/40 backdrop-blur-2xl border-b border-[var(--app-border)]">
          <div className="flex items-center justify-between px-4 lg:px-6 py-3">
            <button
              onClick={() => setSidebarOpen(prev => !prev)}
              className="lg:hidden p-2 -ml-2 rounded-xl hover:bg-[var(--app-hover)] text-[var(--app-muted)] transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {sidebarOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

            <div ref={controlsRef} className="flex flex-wrap items-center justify-end gap-2 lg:gap-3 ml-auto">
              <div className="relative">
                <button
                  onClick={() => toggleMenu('network')}
                  className="flex items-center gap-2 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-xs font-medium transition-colors"
                >
                  <span className="text-[var(--app-muted-2)]">Network</span>
                  <span className="text-[var(--app-text)] capitalize">{network}</span>
                  <svg className="w-3.5 h-3.5 text-[var(--app-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openMenu === 'network' && (
                  <div className="absolute right-0 top-full mt-2 w-40 bg-[var(--app-dropdown-bg)] border border-[var(--app-border)] rounded-xl shadow-xl overflow-hidden z-50">
                    {networks.map(item => (
                      <button
                        key={item.value}
                        onClick={() => { setNetwork(item.value as 'devnet' | 'mainnet'); setOpenMenu(null); }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                          network === item.value ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)]' : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'
                        }`}
                      >
                        {item.label}
                        {network === item.value && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => toggleMenu('theme')}
                  className="flex items-center gap-2 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-xs font-medium transition-colors"
                >
                  <span className="text-[var(--app-muted-2)]">Theme</span>
                  <span className="text-[var(--app-text)] capitalize">{theme}</span>
                  <svg className="w-3.5 h-3.5 text-[var(--app-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openMenu === 'theme' && (
                  <div className="absolute right-0 top-full mt-2 w-40 bg-[var(--app-dropdown-bg)] border border-[var(--app-border)] rounded-xl shadow-xl overflow-hidden z-50">
                    {themes.map(item => (
                      <button
                        key={item.value}
                        onClick={() => { setTheme(item.value as 'dark' | 'light' | 'blue'); setOpenMenu(null); }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
                          theme === item.value ? 'bg-[var(--app-blue)]/15 text-[var(--app-blue-3)]' : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'
                        }`}
                      >
                        {item.label}
                        {theme === item.value && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => toggleMenu('activity')}
                  className="flex items-center gap-2 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl px-3 py-2 text-xs font-medium transition-colors"
                >
                  <span className="text-[var(--app-muted-2)]">Activity</span>
                  <span className="text-[var(--app-text)]">{isConnected ? activity.length : 0}</span>
                  <svg className="w-3.5 h-3.5 text-[var(--app-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
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
                              <span>{item.time}</span>
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
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 relative">
          <div className="mx-auto" style={{ maxWidth: '1280px' }}>
            <Outlet />
          </div>
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}

export default Layout;
