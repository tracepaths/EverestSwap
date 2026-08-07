import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { OctraRpc } from '../services/octraRpc';
import { walletService, type WalletKind } from '../services/walletService';
import { assertMainnetConfigured } from '../config';
import { setTokenCacheNetwork } from '../services/tokenCache';

export type AppTheme = 'dark' | 'light' | 'blue';

export interface Toast {
  id: string;
  type: 'pending' | 'success' | 'error';
  message: string;
  txHash?: string;
  addedAt?: number; // [V7-FIX] For auto-expiry of stuck pending toasts
}

interface AppContextType {
  walletAddress: string;
  walletBalance: string;
  network: 'devnet' | 'mainnet';
  theme: AppTheme;
  isConnected: boolean;
  isWalletInstalled: boolean;
  walletKind: WalletKind;
  has0xio: boolean;
  walletPickerOpen: boolean;
  openWalletPicker: () => void;
  closeWalletPicker: () => void;
  connect: (kind?: WalletKind) => Promise<void>;
  disconnect: () => void;
  setNetwork: (network: 'devnet' | 'mainnet') => void;
  setTheme: (theme: AppTheme) => void;
  rpc: OctraRpc;
  refreshBalance: () => Promise<void>;
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string, txHash?: string) => string;
  removeToast: (id: string) => void;
  updateToast: (id: string, type: Toast['type'], message: string, txHash?: string) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [walletAddress, setWalletAddress] = useState('');
  const [walletBalance, setWalletBalance] = useState('');
  const [network, setNetworkState] = useState<'devnet' | 'mainnet'>('devnet');
  const [theme, setThemeState] = useState<AppTheme>(() => {
    let saved: string | null = null;
    try { saved = typeof window !== 'undefined' ? localStorage.getItem('everestswap-theme') : null; }
    catch (e) { console.warn('[EverestSwap] localStorage unavailable on init:', e instanceof Error ? e.message : 'unknown'); }
    return saved === 'light' || saved === 'blue' || saved === 'dark' ? saved : 'dark';
  });
  const [rpc] = useState(() => new OctraRpc());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isWalletInstalled, setIsWalletInstalled] = useState(false);
  const [walletKind, setWalletKindState] = useState<WalletKind>(() => walletService.kind);
  const [has0xio, setHas0xio] = useState(false);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const isConnecting = useRef(false);

  // [FIX-POPUP] setRpc is a side effect — run it in an effect, not the render
  // body, so React rules hold and StrictMode double-render does not double-fire.
  useEffect(() => { walletService.setRpc(rpc); }, [rpc]);

  useEffect(() => {
    // [FIX-POPUP-REWRITE] Re-evaluate isWalletInstalled reactively. The 0xio
    // extension is detected either by window.wallet0xio / window.ZeroXIOWallet
    // (ZeroXIOAdapter, postMessage bridge — the path the SDK prioritizes) or by
    // window.octra.isOctra (OctraProviderAdapter, RFC-O-1). Without reactive
    // checking, a slow content-script inject leaves the "wallet installed" dot
    // false forever. We listen for the SDK's still-valid readiness broadcasts
    // (0xioWalletReady / wallet0xioReady) — octraWalletReady was removed in
    // SDK v2.7.0 per the changelog, so we don't listen for it here.
    const check = () => {
      const w = window as unknown as {
        octra?: { isOctra?: boolean };
        wallet0xio?: unknown;
        ZeroXIOWallet?: unknown;
      };
      const has = !!(w.octra?.isOctra || w.wallet0xio || w.ZeroXIOWallet);
      setHas0xio(has);
      // Orion is a popup web wallet, always "available" as long as popups are
      // permitted, so the connect affordance should never be gated on it.
      setIsWalletInstalled(has || walletService.kind === 'orion');
    };
    check();
    const onReady = () => check();
    window.addEventListener('0xioWalletReady', onReady);
    window.addEventListener('wallet0xioReady', onReady);
    window.addEventListener('octraWalletReady', onReady);
    return () => {
      window.removeEventListener('0xioWalletReady', onReady);
      window.removeEventListener('wallet0xioReady', onReady);
      window.removeEventListener('octraWalletReady', onReady);
    };
  }, []);

  // [V7-FIX] Auto-expire stuck pending toasts after 60s. Convert to error state
  // with timeout message so user knows the tx status is uncertain.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setToasts(prev => prev.map(t => {
        if (t.type !== 'pending') return t;
        if (t.addedAt && (now - t.addedAt) >= 60_000) {
          return { ...t, type: 'error', message: t.message + ' (timeout - check status)' };
        }
        return t;
      }));
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // [SECURITY] FM-2: Log localStorage errors for diagnostics (without leaking user data)
    try { localStorage.setItem('everestswap-theme', theme); }
    catch (e) { console.warn('[EverestSwap] localStorage unavailable:', e instanceof Error ? e.message : 'unknown'); }
  }, [theme]);

  // [SECURITY] FM-1: Use crypto.randomUUID for collision-free toast IDs
  const addToast = useCallback((type: Toast['type'], message: string, txHash?: string) => {
    const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    // [V7-FIX] Track addedAt for auto-expiry of stuck pending toasts
    setToasts(prev => [...prev, { id, type, message, txHash, addedAt: Date.now() }]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const updateToast = useCallback((id: string, type: Toast['type'], message: string, txHash?: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, type, message, txHash } : t));
  }, []);

  const isConnected = walletAddress !== '';

  // [V9] Listen for wallet account changes dispatched by walletService.
  // Updates React state immediately when the user switches accounts in the
  // wallet extension, preventing stale-address "invalid signature" errors.
  // [FIX] Empty address = wallet locked/disconnected → clear UI state so the
  // app shows "Connect Wallet" instead of a stale connected state.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ address: string }>).detail;
      if (detail?.address === '') {
        setWalletAddress('');
        setWalletBalance('');
        return;
      }
      if (detail?.address && detail.address !== walletAddress) {
        setWalletAddress(detail.address);
        walletService.getBalance().then(b => setWalletBalance(b)).catch(() => {});
      }
    };
    window.addEventListener('wallet-account-changed', handler);
    return () => window.removeEventListener('wallet-account-changed', handler);
  }, [walletAddress]);

  // [V7-FIX] Poll wallet connection to detect external disconnect (user locks
  // extension, uninstalls, etc.). React state doesn't auto-update.
  // [V7-PASS10] CRITICAL-3: debounce — require 2 consecutive empty checks (~10s)
  // before treating the wallet as disconnected. Avoids false disconnects during
  // cold start, locked extension, or slow account switching.
  // [V9] Also detect account changes (non-empty but different address) as a
  // fallback in case the custom event listener misses a change.
  useEffect(() => {
    if (!isConnected) return;
    let emptyStreak = 0;
    const i = setInterval(() => {
      const currentAddress = walletService.address;
      if (currentAddress === '' && walletAddress !== '') {
        emptyStreak++;
        if (emptyStreak >= 2) {
          setWalletAddress('');
          setWalletBalance('');
          emptyStreak = 0;
        }
      } else if (currentAddress !== '' && currentAddress !== walletAddress) {
        // Account changed in wallet extension (fallback detection)
        setWalletAddress(currentAddress);
        walletService.getBalance().then(b => setWalletBalance(b)).catch(() => {});
        emptyStreak = 0;
      } else {
        emptyStreak = 0;
      }
    }, 5000);
    return () => clearInterval(i);
  }, [isConnected, walletAddress]);

  const connect = useCallback(async (kind?: WalletKind) => {
    if (isConnecting.current) return;
    isConnecting.current = true;
    // If a kind is supplied, persist it before connecting (Orion connect needs
    // the gesture, so this runs directly in the WalletConnector click handler).
    if (kind) {
      walletService.setKind(kind);
      setWalletKindState(kind);
    }
    // [SECURITY] FM-1: If wallet already connected to the same address, no-op
    if (walletAddress !== '' && walletService.address === walletAddress) {
      isConnecting.current = false;
      return;
    }
    // [SECURITY] FM-1: If different address, clear stale state before connecting
    if (walletAddress !== '' && walletService.address !== walletAddress) {
      setWalletAddress('');
      setWalletBalance('');
    }
    try {
      const address = await walletService.connect();
      if (address !== walletService.address) {
        // Wallet state changed during async connect, abort
        isConnecting.current = false;
        return;
      }
      setWalletAddress(address);
      const balance = await walletService.getBalance();
      setWalletBalance(balance);
    } finally {
      isConnecting.current = false;
    }
  }, [walletAddress]);

  // [SECURITY] F-1: Await walletService.disconnect() to prevent race with connect()
  const disconnect = useCallback(async () => {
    try {
      await walletService.disconnect();
    } catch (e) {
      // Log but don't fail — UI state should be cleared regardless
      console.warn('Wallet disconnect failed:', e instanceof Error ? e.message : 'unknown');
    }
    setWalletAddress('');
    setWalletBalance('');
  }, []);

  const openWalletPicker = useCallback(() => setWalletPickerOpen(true), []);
  const closeWalletPicker = useCallback(() => setWalletPickerOpen(false), []);

  const setNetwork = useCallback((n: 'devnet' | 'mainnet') => {
    if (n === 'mainnet') {
      assertMainnetConfigured();
    }
    setNetworkState(n);
    rpc.setNetwork(n);
    // [V7-FIX] Clear stale state when network changes
    setTokenCacheNetwork(n);
    setWalletBalance('');
    setToasts([]);  // Clear stale toasts
  }, [rpc]);

  const setTheme = useCallback((t: AppTheme) => {
    setThemeState(t);
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) return;
    const balance = await walletService.getBalance();
    setWalletBalance(balance);
  }, [walletAddress]);

  return (
    <AppContext.Provider
      value={{
        walletAddress,
        walletBalance,
        network,
        theme,
        isConnected,
        isWalletInstalled,
        walletKind,
        has0xio,
        walletPickerOpen,
        openWalletPicker,
        closeWalletPicker,
        connect,
        disconnect,
        setNetwork,
        setTheme,
        rpc,
        refreshBalance,
        toasts,
        addToast,
        removeToast,
        updateToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
