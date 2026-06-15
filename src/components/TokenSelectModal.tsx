import { useState, useEffect, useRef, useMemo } from 'react';
import type { OctraRpc } from '../services/octraRpc';
import { OCT_TOKEN, WOCT_TOKEN, OES_TOKEN, CONTRACTS } from '../types';

interface TokenItem {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isCommon: boolean;
  isTrusted: boolean;
  balance: string | null;
}

const COMMON_TOKENS = [
  { address: OCT_TOKEN.address, symbol: OCT_TOKEN.symbol, name: OCT_TOKEN.name, decimals: OCT_TOKEN.decimals },
  { address: WOCT_TOKEN.address, symbol: WOCT_TOKEN.symbol, name: WOCT_TOKEN.name, decimals: WOCT_TOKEN.decimals },
  { address: OES_TOKEN.address, symbol: OES_TOKEN.symbol, name: OES_TOKEN.name, decimals: OES_TOKEN.decimals },
];

function isValidOctraAddress(address: string): boolean {
  return /^oct[1-9A-HJ-NP-Za-km-z]{43,48}$/.test(address);
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (address: string, meta: { symbol: string; name: string; decimals: number }) => void;
  rpc: OctraRpc;
  excludeAddress?: string;
  walletAddress?: string;
  isConnected?: boolean;
}

export default function TokenSelectModal({ isOpen, onClose, onSelect, rpc, excludeAddress, walletAddress, isConnected }: Props) {
  const [query, setQuery] = useState('');
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [importAddr, setImportAddr] = useState('');
  const [importMeta, setImportMeta] = useState<{ symbol: string; name: string; decimals: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setImportMode(false);
      setImportAddr('');
      setImportMeta(null);
      return;
    }
    setLoading(true);
    setTokens([]);
    (async () => {
      try {
        const trustedAddrs = await rpc.getTrustedTokens(CONTRACTS.factory);
        const metaPromises = trustedAddrs.map(async (addr) => {
          try {
            const meta = await rpc.getTokenMeta(addr);
            return { address: addr, ...meta, isCommon: false, isTrusted: true, balance: null } as TokenItem;
          } catch {
            return null;
          }
        });
        const results = (await Promise.all(metaPromises)).filter((t): t is TokenItem => t !== null);
        const knownAddrs = new Set(COMMON_TOKENS.map(t => t.address));
        const deduped = [
          ...COMMON_TOKENS.map(t => ({ ...t, isCommon: true, isTrusted: true, balance: null as null })),
          ...results.filter(t => !knownAddrs.has(t.address)),
        ];
        setTokens(deduped as TokenItem[]);
      } catch {
        setTokens(COMMON_TOKENS.map(t => ({ ...t, isCommon: true, isTrusted: true, balance: null })));
      } finally {
        setLoading(false);
        setTimeout(() => searchRef.current?.focus(), 100);
      }
    })();
  }, [isOpen, rpc]);

  useEffect(() => {
    if (!isOpen || !isConnected || !walletAddress || tokens.length === 0) return;
    setBalanceLoading(true);
    (async () => {
      const results = await Promise.all(tokens.map(async (t) => {
        try {
          let bal: string;
          if (t.address === '') {
            const b = await rpc.getBalance(walletAddress);
            bal = b.balance_raw;
          } else {
            bal = await rpc.getTokenBalance(t.address, walletAddress);
          }
          return { address: t.address, balance: bal };
        } catch {
          return { address: t.address, balance: '0' };
        }
      }));
      setTokens(prev => prev.map(t => {
        const found = results.find(r => r.address === t.address);
        return { ...t, balance: found?.balance ?? '0' };
      }));
      setBalanceLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isConnected, walletAddress, tokens.length]);

  const { myTokens, otherTokens } = useMemo(() => {
    const mine: TokenItem[] = [];
    const others: TokenItem[] = [];
    for (const t of tokens) {
      if (t.balance !== null && t.balance !== '0') {
        mine.push(t);
      } else {
        others.push(t);
      }
    }
    return { myTokens: mine, otherTokens: others };
  }, [tokens]);

  const filteredMine = useMemo(() => {
    if (!query) return myTokens;
    const q = query.toLowerCase();
    return myTokens.filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q)
    );
  }, [query, myTokens]);

  const filteredOthers = useMemo(() => {
    if (!query) return otherTokens;
    const q = query.toLowerCase();
    return otherTokens.filter(t =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q)
    );
  }, [query, otherTokens]);

  const handleSelect = (item: TokenItem) => {
    if (item.address === excludeAddress) return;
    onSelect(item.address, { symbol: item.symbol, name: item.name, decimals: item.decimals });
    onClose();
  };

  const handleImport = async () => {
    if (!isValidOctraAddress(importAddr)) {
      setImportMeta({ symbol: '???', name: 'Invalid Octra address', decimals: 6 });
      return;
    }
    setImporting(true);
    setImportMeta(null);
    try {
      const meta = await rpc.getTokenMeta(importAddr);
      const decimals = Number.isFinite(meta.decimals) && meta.decimals >= 0 && meta.decimals <= 18 ? meta.decimals : 6;
      if (!meta.symbol || meta.symbol === '???' || !meta.name || meta.name === 'Unknown') {
        setImportMeta({ symbol: '???', name: 'Unknown', decimals });
      } else {
        setImportMeta({ ...meta, decimals });
      }
    } catch {
      setImportMeta({ symbol: '???', name: 'Unknown', decimals: 6 });
    } finally {
      setImporting(false);
    }
  };

  const handleImportSelect = () => {
    if (!importMeta || importMeta.symbol === '???') return;
    onSelect(importAddr, importMeta);
    onClose();
  };

  function formatBalance(balance: string, decimals: number): string {
    // [V7-SECURITY-FIX] Clamp decimals to safe range
    const safeDecimals = Math.max(0, Math.min(18, decimals));
    const num = Number(balance) / 10 ** safeDecimals;
    if (num === 0) return '0';
    if (num < 0.0001) return '<0.0001';
    if (num < 1) return num.toFixed(4);
    if (num < 1000) return num.toFixed(2);
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function TokenRow({ item }: { item: TokenItem }) {
    const disabled = item.address === excludeAddress;
    return (
      <button
        onClick={() => handleSelect(item)}
        disabled={disabled}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
          disabled
            ? 'opacity-30 cursor-not-allowed'
            : 'hover:bg-[var(--app-hover)]'
        }`}
      >
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 border-[var(--app-border-soft)] shrink-0 ${item.isCommon ? 'bg-[var(--app-blue)]' : 'bg-[var(--app-blue-2)]'}`}>
          {item.symbol[0] || '?'}
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-sm">{item.symbol}</span>
            {item.isTrusted && (
              <span className="text-[10px] text-[var(--app-warning)] shrink-0" title="Trusted">★★★★★</span>
            )}
          </div>
          <div className="text-xs text-[var(--app-muted)] truncate">{item.name}</div>
        </div>
        {item.balance !== null && (
          <span className="text-xs text-[var(--app-text)] font-mono shrink-0">
            {formatBalance(item.balance, item.decimals)}
          </span>
        )}
        {disabled && (
          <span className="text-[10px] text-[var(--app-muted-2)]">Selected</span>
        )}
      </button>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xl z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] max-w-sm w-full flex flex-col max-h-[80vh] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--app-border)]">
          <h3 className="text-base font-semibold">Select a token</h3>
          <button onClick={onClose} className="text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 pt-3 pb-2">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--app-muted-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search name or paste address"
              className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none placeholder-[var(--app-muted-2)] focus:border-[var(--app-blue)] transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-0.5 min-h-0">
          {loading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 bg-[var(--app-panel-soft)] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : filteredMine.length === 0 && filteredOthers.length === 0 ? (
            <div className="text-center py-8 text-sm text-[var(--app-muted)]">
              {query ? 'No tokens found' : 'No tokens available'}
            </div>
          ) : (
            <>
              {balanceLoading && (
                <div className="text-[10px] text-[var(--app-muted-2)] text-center py-1">Loading balances...</div>
              )}
              {isConnected && filteredMine.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 px-3 py-1.5">
                    <svg className="w-3.5 h-3.5 text-[var(--app-muted-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
                    </svg>
                    <span className="text-[10px] uppercase tracking-wider text-[var(--app-muted-2)] font-semibold">My Tokens</span>
                  </div>
                  {filteredMine.map(item => (
                    <TokenRow key={item.address} item={item} />
                  ))}
                  <div className="h-px bg-[var(--app-panel)] my-2" />
                </>
              )}
              {filteredOthers.length > 0 && (
                <>
                  {isConnected && filteredMine.length > 0 && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5">
                      <svg className="w-3.5 h-3.5 text-[var(--app-muted-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                      </svg>
                      <span className="text-[10px] uppercase tracking-wider text-[var(--app-muted-2)] font-semibold">More Tokens</span>
                    </div>
                  )}
                  {filteredOthers.map(item => (
                    <TokenRow key={item.address} item={item} />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[var(--app-border)] px-5 py-3">
          {!importMode ? (
            <button
              onClick={() => { setImportMode(true); setImportAddr(''); setImportMeta(null); }}
              className="w-full flex items-center gap-2 text-sm text-[var(--app-blue-3)] hover:text-[var(--app-blue-3)] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m0 0l4-4m-4 4l-4-4" />
              </svg>
              Import token
            </button>
          ) : (
            <div className="space-y-2">
              <div className="text-[10px] text-orange-400 bg-orange-400/10 rounded-lg px-3 py-1.5">
                Imported tokens are not verified. Do your own research before trading.
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={importAddr}
                  onChange={e => { setImportAddr(e.target.value); setImportMeta(null); }}
                  placeholder="oct..."
                  className="flex-1 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-1.5 text-sm font-mono outline-none placeholder-[var(--app-muted-2)]"
                />
                <button
                  onClick={handleImport}
                  disabled={importing || !isValidOctraAddress(importAddr)}
                  className="px-3 py-1.5 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-lg text-sm font-medium transition-colors"
                >
                  {importing ? '...' : 'Import'}
                </button>
              </div>
              {importMeta && (
                <div className="flex items-center justify-between bg-[var(--app-panel-soft)] rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-[var(--app-blue-2)] flex items-center justify-center text-xs font-bold border-2 border-[var(--app-border-soft)]">
                      {importMeta.symbol[0] || '?'}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{importMeta.symbol}</div>
                      <div className="text-xs text-[var(--app-muted)]">{importMeta.name}</div>
                    </div>
                  </div>
                  <button
                    onClick={handleImportSelect}
                    disabled={importMeta.symbol === '???'}
                    className="px-3 py-1 text-xs bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-lg font-medium transition-colors"
                  >
                    Select
                  </button>
                </div>
              )}
              <button
                onClick={() => setImportMode(false)}
                className="text-xs text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
