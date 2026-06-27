import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { getTxHistory, type TxRecord } from '../services/txHistory';
import { tokenStorage } from '../services/tokenStorage';
import { getCachedMeta } from '../services/tokenCache';
import { MAINNET_CONFIGURED, CONTRACTS, type TokenInfo } from '../types';
import { EXPLORER_URL, EXPLORER_TX_PATH } from '../config';
import { formatUnits, truncateAddress } from '../services/swapService';

type AssetItem = {
  symbol: string;
  name: string;
  address: string;
  balance: string;
  valueUsd: number;
  source: 'wallet' | 'trusted' | 'lp';
};

export default function PortfolioPage() {
  const navigate = useNavigate();
  const { walletAddress, isConnected, walletBalance, rpc } = useApp();

  const [trustedTokens, setTrustedTokens] = useState<TokenInfo[]>([]);
  const [savedTokens, setSavedTokens] = useState<TokenInfo[]>([]);
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});
  const [lpPositions, setLpPositions] = useState<Array<{ pool: string; lp: string; tokenA: string; tokenB: string; share: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [assetsLimit, setAssetsLimit] = useState<number>(5);
  const [lpLimit, setLpLimit] = useState<number>(5);
  const [txsLimit, setTxsLimit] = useState<number>(5);

  const loadPortfolio = useCallback(async () => {
    if (!isConnected || !walletAddress) return;
    setLoading(true);
    try {
      const [trusted, saved] = await Promise.all([
        rpc.getTrustedTokens(CONTRACTS.factory),
        Promise.resolve(tokenStorage.getAll()),
      ]);
      const trustedMeta = await Promise.all(
        trusted.map(async (addr: string) => {
          const meta = await rpc.getTokenMeta(addr).catch(() => null);
          if (!meta) return null;
          return { address: addr, symbol: meta.symbol || getCachedMeta(addr)?.symbol || addr.slice(0, 6), name: meta.name || addr, decimals: meta.decimals ?? 6 } satisfies TokenInfo;
        }),
      );
      setTrustedTokens(trustedMeta.filter(Boolean) as TokenInfo[]);
      setSavedTokens(saved);

      const balanceEntries = await Promise.all(
        [...new Set([...trusted, ...saved.map((t: TokenInfo) => t.address)])].map(async addr => {
          const bal = await rpc.getTokenBalance(addr, walletAddress).catch(() => '0');
          return [addr, bal] as const;
        }),
      );
      setTokenBalances(Object.fromEntries(balanceEntries));

      const allPools = await rpc.getAllPools(CONTRACTS.factory).catch(() => []);
      const positions = await Promise.all(
        allPools.map(async poolAddr => {
          const pos = await rpc.getPositions(poolAddr, walletAddress).catch(() => [] as Awaited<ReturnType<typeof rpc.getPositions>>);
          if (pos.length === 0) return [];
          const metaA = await rpc.getTokenMeta(await rpc.contractView<string>(poolAddr, 'get_token_a', []).catch(() => '' as string)).catch(() => null);
          const metaB = await rpc.getTokenMeta(await rpc.contractView<string>(poolAddr, 'get_token_b', []).catch(() => '' as string)).catch(() => null);
          const totalLP = await rpc.contractView<string>(poolAddr, 'total_lp_supply', []).catch(() => '0');
      const totalLpNum = Number(totalLP);
      return pos.map(p => {
            const lpNum = Number(p.liquidity);
            const share = totalLpNum > 0 ? (lpNum / totalLpNum) * 100 : 0;
            return {
              pool: poolAddr,
              lp: String(p.liquidity),
              lpNum,
              share,
              tokenA: metaA?.symbol ?? poolAddr.slice(0, 6),
              tokenB: metaB?.symbol ?? poolAddr.slice(4, 10),
            };
          });
        }),
      );
      setLpPositions(positions.flat());
      setTxs(getTxHistory());
      setLastUpdated(Date.now());
    } finally {
      setLoading(false);
    }
  }, [isConnected, walletAddress, rpc]);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  const decimalsByAddress = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of [...trustedTokens, ...savedTokens]) {
      if (typeof t.decimals === 'number' && t.decimals >= 0 && t.decimals <= 18) {
        map[t.address] = t.decimals;
      } else {
        const cached = getCachedMeta(t.address);
        map[t.address] = cached?.decimals ?? 6;
      }
    }
    return map;
  }, [trustedTokens, savedTokens]);

  const decimalsOf = useCallback((address: string): number => {
    const d = decimalsByAddress[address];
    if (typeof d === 'number') return d;
    const cached = getCachedMeta(address);
    return cached?.decimals ?? 6;
  }, [decimalsByAddress]);

  function getExplorerTxUrl(hash: string): string {
    return buildExplorerTxUrl(hash);
  }

  const assets = useMemo<AssetItem[]>(() => {
    const list: AssetItem[] = [];
    for (const token of trustedTokens) {
      const balance = tokenBalances[token.address] ?? '0';
      list.push({ symbol: token.symbol, name: token.name, address: token.address, balance, valueUsd: 0, source: 'trusted' });
    }
    for (const token of savedTokens) {
      if (list.some(item => item.address === token.address)) continue;
      const balance = tokenBalances[token.address] ?? '0';
      list.push({ symbol: token.symbol, name: token.name, address: token.address, balance, valueUsd: 0, source: 'wallet' });
    }
    return list.sort((a, b) => Number(b.balance) - Number(a.balance));
  }, [trustedTokens, savedTokens, tokenBalances]);

  const totalTokens = assets.length;
  const totalPositions = lpPositions.length;

  if (!isConnected) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-xl w-full bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold">Portfolio</h1>
          <p className="text-sm text-[var(--app-muted)]">Connect wallet to see assets, trusted tokens, LP positions, and recent activity.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portfolio</h1>
          <p className="text-sm text-[var(--app-muted)]">
            {truncateAddress(walletAddress)} · {MAINNET_CONFIGURED ? 'mainnet ready' : 'devnet'}
            {lastUpdated ? ` · updated ${new Date(lastUpdated).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadPortfolio()}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[var(--app-blue)] text-white font-medium hover:opacity-90 transition-opacity"
        >
          <span className={loading ? 'animate-spin' : ''}>↻</span>
          Refresh
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Assets tracked" value={String(totalTokens)} helper="Trusted + saved tokens" />
        <StatCard label="LP positions" value={String(totalPositions)} helper="All active pools" />
        <StatCard label="Native balance" value={walletBalance || '0'} helper="OCT in wallet" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.85fr]">
        <section className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Assets</h2>
              <p className="text-sm text-[var(--app-muted)]">Trusted tokens and any tokens you saved/imported.</p>
            </div>
          </div>

          <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
            {assets.slice(0, assetsLimit).length === 0 ? (
              <EmptyState title="No assets tracked" body="Import or trust a token to see it here." />
            ) : (
              assets.slice(0, assetsLimit).map(asset => (
                <button
                  key={asset.address}
                  type="button"
                  onClick={() => navigate(`/swap?token=${encodeURIComponent(asset.address)}`)}
                  className="w-full text-left bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl p-4 flex items-center justify-between gap-4 hover:border-[var(--app-blue)]/40 hover:bg-[var(--app-panel)]/60 transition-colors cursor-pointer"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{asset.symbol}</span>
                      <Badge label={asset.source === 'trusted' ? 'Trusted' : 'Saved'} />
                    </div>
                    <div className="text-sm text-[var(--app-muted)]">{asset.name}</div>
                    <div className="text-xs text-[var(--app-muted-2)] mt-1 font-mono">{asset.address}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold font-mono">{formatUnits(asset.balance, decimalsOf(asset.address))} <span className="text-[var(--app-muted)] text-xs">{asset.symbol}</span></div>
                    <div className="text-xs text-[var(--app-muted)]">~${asset.valueUsd.toFixed(2)}</div>
                  </div>
                </button>
              ))
            )}

            {assets.length > assetsLimit && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setAssetsLimit(assetsLimit === 5 ? assets.length : 5)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--app-panel)] border border-[var(--app-border)] hover:border-[var(--app-blue)]/40 text-[var(--app-muted)] hover:text-[var(--app-fg)] transition-colors"
                >
                  {assetsLimit === 5 ? `Show all ${assets.length}` : "Show less"}
                  <svg className={assetsLimit === 5 ? "" : "rotate-180"} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
              </div>
            )}

          </div>
        </section>

        <aside className="space-y-6">
          <section className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">LP positions</h2>
              <p className="text-sm text-[var(--app-muted)]">Liquidity positions owned by this wallet.</p>
            </div>
            <div className="space-y-3 max-h-[360px] overflow-auto pr-1">
              {lpPositions.length === 0 ? (
                <EmptyState title="No LP positions" body="Create or add liquidity to see positions here." />
              ) : lpPositions.slice(0, lpLimit).map((pos, idx) => {
                const symA = pos.tokenA || '?';
                const symB = pos.tokenB || '?';
                const colorA = tickerColor(symA);
                const colorB = tickerColor(symB);
                return (
                <button
                  key={`${pos.pool}-${idx}`}
                  type="button"
                  onClick={() => navigate(`/pool?pool=${encodeURIComponent(pos.pool)}`)}
                  className="w-full text-left bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl p-3 sm:p-4 hover:border-[var(--app-blue)]/40 hover:bg-[var(--app-panel)]/60 transition-colors cursor-pointer"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex -space-x-2 shrink-0">
                        <span className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full ${colorA} flex items-center justify-center text-[11px] sm:text-xs font-bold ring-2 ring-[var(--app-panel-soft)]`}>{symA.slice(0, 3)}</span>
                        <span className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full ${colorB} flex items-center justify-center text-[11px] sm:text-xs font-bold ring-2 ring-[var(--app-panel-soft)]`}>{symB.slice(0, 3)}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-sm sm:text-base truncate">{symA} / {symB}</div>
                        <div className="text-[11px] sm:text-xs text-[var(--app-muted-2)] font-mono truncate">{pos.pool}</div>
                      </div>
                    </div>
                    <div className="text-left sm:text-right pl-11 sm:pl-0">
                      <div className="font-semibold text-sm sm:text-base">{formatUnits(pos.lp, 12)} LP</div>
                      <div className="text-[11px] sm:text-xs text-[var(--app-muted)]">pool share · {pos.share ? pos.share + '%' : '—'}</div>
                    </div>
                  </div>
                </button>
                );
              })}
            </div>

            {lpPositions.length > lpLimit && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setLpLimit(lpLimit === 5 ? lpPositions.length : 5)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--app-panel)] border border-[var(--app-border)] hover:border-[var(--app-blue)]/40 text-[var(--app-muted)] hover:text-[var(--app-fg)] transition-colors"
                >
                  {lpLimit === 5 ? `Show all ${lpPositions.length}` : "Show less"}
                  <svg className={lpLimit === 5 ? "" : "rotate-180"} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
              </div>
            )}
          </section>

          <section className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Recent activity</h2>
              <p className="text-sm text-[var(--app-muted)]">Local history of swaps and liquidity actions.</p>
            </div>
            <div className="space-y-3 max-h-[360px] overflow-auto pr-1">
              {txs.length === 0 ? (
                <EmptyState title="No recent activity" body="Your swaps and liquidity actions will appear here." />
              ) : txs.slice(0, txsLimit).map(tx => {
                const explorerUrl = getExplorerTxUrl(tx.hash);
                return (
                <a
                  key={tx.hash}
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl p-4 hover:border-[var(--app-blue)]/40 hover:bg-[var(--app-panel)]/60 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold capitalize">{tx.type.replaceAll('_', ' ')}</div>
                      <div className="text-sm text-[var(--app-muted)]">{tx.summary}</div>
                    </div>
                    <Badge label={tx.status === 'success' ? 'Success' : 'Failed'} tone={tx.status === 'success' ? 'success' : 'danger'} />
                  </div>
                  <div className="mt-2 text-xs text-[var(--app-muted-2)] font-mono break-all underline-offset-2 group-hover:underline">{tx.hash}</div>
                </a>
                );
              })}
            </div>

            {txs.length > txsLimit && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setTxsLimit(txsLimit === 5 ? txs.length : 5)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--app-panel)] border border-[var(--app-border)] hover:border-[var(--app-blue)]/40 text-[var(--app-muted)] hover:text-[var(--app-fg)] transition-colors"
                >
                  {txsLimit === 5 ? `Show all ${txs.length}` : "Show less"}
                  <svg className={txsLimit === 5 ? "" : "rotate-180"} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function StatCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-5">
      <div className="text-xs uppercase tracking-[0.2em] text-[var(--app-muted-2)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-[var(--app-muted)]">{helper}</div>
    </div>
  );
}

function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'danger' }) {
  const toneClass = tone === 'success'
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : tone === 'danger'
      ? 'bg-red-500/15 text-red-300 border-red-500/30'
      : 'bg-[var(--app-panel)] text-[var(--app-muted)] border-[var(--app-border)]';
  return <span className={`inline-flex items-center px-2 py-1 rounded-lg text-[11px] border ${toneClass}`}>{label}</span>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--app-border)] bg-[var(--app-panel-soft)] p-5 text-center">
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-[var(--app-muted)] mt-1">{body}</div>
    </div>
  );
}

function tickerColor(symbol: string): string {
  const palette = [
    'bg-rose-500/20 text-rose-300',
    'bg-amber-500/20 text-amber-300',
    'bg-emerald-500/20 text-emerald-300',
    'bg-sky-500/20 text-sky-300',
    'bg-violet-500/20 text-violet-300',
    'bg-fuchsia-500/20 text-fuchsia-300',
    'bg-orange-500/20 text-orange-300',
    'bg-lime-500/20 text-lime-300',
  ];
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = (hash * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}
