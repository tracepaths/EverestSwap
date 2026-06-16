import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { OctraRpc } from '../services/octraRpc';
import { walletService } from '../services/walletService';
import { assertMainnetConfigured } from '../config';

export type AppTheme = 'dark' | 'light' | 'blue';

export interface Toast {
  id: string;
  type: 'pending' | 'success' | 'error';
  message: string;
  txHash?: string;
}

interface AppContextType {
  walletAddress: string;
  walletBalance: string;
  network: 'devnet' | 'mainnet';
  theme: AppTheme;
  isConnected: boolean;
  isWalletInstalled: boolean;
  connect: () => Promise<void>;
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
  const isConnecting = useRef(false);

  useEffect(() => {
    setIsWalletInstalled(!!(window as unknown as { octra?: { isOctra?: boolean } }).octra?.isOctra);
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
    setToasts(prev => [...prev, { id, type, message, txHash }]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const updateToast = useCallback((id: string, type: Toast['type'], message: string, txHash?: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, type, message, txHash } : t));
  }, []);

  const isConnected = walletAddress !== '';

  const connect = useCallback(async () => {
    if (isConnecting.current) return;
    isConnecting.current = true;
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

  const setNetwork = useCallback((n: 'devnet' | 'mainnet') => {
    if (n === 'mainnet') {
      assertMainnetConfigured();
    }
    setNetworkState(n);
    rpc.setNetwork(n);
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
