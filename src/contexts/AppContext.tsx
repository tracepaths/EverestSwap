import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { OctraRpc } from '../services/octraRpc';
import { walletService } from '../services/walletService';

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
    const saved = typeof window !== 'undefined' ? localStorage.getItem('everestswap-theme') : null;
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
    localStorage.setItem('everestswap-theme', theme);
  }, [theme]);

  const addToast = useCallback((type: Toast['type'], message: string, txHash?: string) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
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
    try {
      const address = await walletService.connect();
      setWalletAddress(address);
      const balance = await walletService.getBalance();
      setWalletBalance(balance);
    } finally {
      isConnecting.current = false;
    }
  }, []);

  const disconnect = useCallback(() => {
    walletService.disconnect();
    setWalletAddress('');
    setWalletBalance('');
  }, []);

  const setNetwork = useCallback((n: 'devnet' | 'mainnet') => {
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
