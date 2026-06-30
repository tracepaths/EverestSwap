import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { getTxHistory, type TxRecord } from '../services/txHistory';
import { tokenStorage } from '../services/tokenStorage';
import { getCachedMeta } from '../services/tokenCache';
import { MAINNET_CONFIGURED, CONTRACTS, WOCT_TOKEN, type TokenInfo } from '../types';
import { buildExplorerTxUrl } from '../config';
import { formatUnits, truncateAddress } from '../services/swapService';
import { usePriceService } from '../hooks/usePriceService';
import { calculateRating } from '../services/trustRating';
import TokenTrustBadge from '../components/TokenTrustBadge';

type AssetItem = {
  symbol: string;
  name: string;
  address: string;
  balance: string;
  valueUsd: number;
  source: 'wallet' | 'trusted' | 'lp';
  rating: number;
  votes: number;
  hasVoted: boolean;
  hasLockedLp: boolean;
};

export default function PortfolioPage() {
  const navigate = useNavigate();
  const { walletAddress, isConnected, walletBalance, rpc } = useApp();
  const { getTokenUsd, calculateUsdValue, loading: priceLoading, octPrice } = usePriceService(rpc);

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
  const [trustVoteState, setTrustVoteState] = useState<Record<string, { rating: number; votes: number; hasVoted: boolean; hasLockedLp: boolean }>>({});

  type ModalState =
    | { kind: 'asset'; data: AssetItem }
    | { kind: 'position'; data: typeof lpPositions[number] }
    | { kind: 'activity'; data: TxRecord }
    | null;
  const [modal, setModal] = useState<ModalState>(null);

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
          const info = await rpc.getPoolInfo(poolAddr).catch(() => null);
          if (!info || !info.tokenA || !info.tokenB) return [];
          const [metaA, metaB] = await Promise.all([
            rpc.getTokenMeta(info.tokenA).catch(() => null),
            rpc.getTokenMeta(info.tokenB).catch(() => null),
          ]);
          const totalLP = info.totalLP;
          const totalLpNum = Number(totalLP);
          return pos.map(p => {
            const lpNum = Number(p.liquidity);
            const share = totalLpNum > 0 ? (lpNum / totalLpNum) * 100 : 0;
            const resolveSymbol = (addr: string, meta: { symbol?: string } | null): string => {
              if (meta?.symbol && meta.symbol !== '???') return meta.symbol;
              if (addr === '') return 'OCT';
              if (addr.toLowerCase() === WOCT_TOKEN.address.toLowerCase()) return 'WOCT';
              return addr.slice(0, 6);
            };
            return {
              pool: poolAddr,
              lp: String(p.liquidity),
              lpNum,
              share,
              tokenA: resolveSymbol(info.tokenA, metaA),
              tokenB: resolveSymbol(info.tokenB, metaB),
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

  // [V8] Load trust ratings and vote eligibility for portfolio tokens
  useEffect(() => {
    if (!isConnected || !walletAddress) return;
    let cancelled = false;
    async function loadTrustRatings() {
      const allTokens = [...trustedTokens, ...savedTokens];
      const newState: Record<string, { rating: number; votes: number; hasVoted: boolean; hasLockedLp: boolean }> = {};
      
      // Get all pools to check locked LP
      const allPools = await rpc.getAllPools(CONTRACTS.factory).catch(() => []);
      const lockedTokens = new Set<string>();
      
      // Check locked LP for each pool
      for (const poolAddr of allPools) {
        if (cancelled) break;
        try {
          const [info, lockedLp] = await Promise.all([
            rpc.getPoolInfo(poolAddr),
            rpc.getLockedLiquidity(poolAddr, walletAddress),
          ]);
          if (lockedLp > 0) {
            // User has locked LP in this pool
            lockedTokens.add(info.tokenA);
            lockedTokens.add(info.tokenB);
          }
        } catch {
          // Skip this pool
        }
      }
      
      // Calculate ratings for tokens with locked LP
      for (const token of allTokens) {
        if (cancelled) break;
        const hasLockedLp = lockedTokens.has(token.address);
        try {
          const ratingInfo = await calculateRating({
            rpc,
            factoryAddress: CONTRACTS.factory,
            tokenAddress: token.address,
            walletAddress,
            isTrusted: trustedTokens.some(t => t.address === token.address),
          });
          newState[token.address] = {
            rating: ratingInfo.rating,
            votes: ratingInfo.votes,
            hasVoted: ratingInfo.hasVoted,
            hasLockedLp,
          };
        } catch {
          newState[token.address] = { rating: 1, votes: 0, hasVoted: false, hasLockedLp };
        }
      }
      
      if (!cancelled) {
        setTrustVoteState(newState);
      }
    }
    void loadTrustRatings();
    return () => { cancelled = true; };
  }, [isConnected, walletAddress, rpc, trustedTokens, savedTokens]);

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

  const handleVote = useCallback(async (address: string) => {
    if (!isConnected || !walletAddress || !address) return;
    const current = trustVoteState[address];
    if (!current || !current.hasLockedLp) return;
    try {
      if (current.hasVoted) {
        await rpc.unvoteToken(CONTRACTS.factory, address);
      } else {
        await rpc.voteToken(CONTRACTS.factory, address);
      }
      // Refresh portfolio to update vote state
      await loadPortfolio();
    } catch (err) {
      console.error('[PortfolioPage] Vote failed:', err);
    }
  }, [isConnected, walletAddress, rpc, trustVoteState, loadPortfolio]);

  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    async function fetchPrices() {
      if (!isConnected || !walletAddress) return;
      const prices: Record<string, number> = {};
      for (const token of [...trustedTokens, ...savedTokens]) {
        if (!cancelled) {
          const price = await getTokenUsd(token.address);
          prices[token.address] = price;
        }
      }
      if (!cancelled) setAssetPrices(prices);
    }
    fetchPrices();
    return () => { cancelled = true; };
  }, [isConnected, walletAddress, trustedTokens, savedTokens, getTokenUsd]);

  const assets = useMemo<AssetItem[]>(() => {
    const list: AssetItem[] = [];
    const state = trustVoteState;
    for (const token of trustedTokens) {
      const balance = tokenBalances[token.address] ?? '0';
      const dec = decimalsOf(token.address);
      const price = assetPrices[token.address] ?? 0;
      const valueUsd = calculateUsdValue(balance, dec, price);
      const info = state[token.address] || { rating: 1, votes: 0, hasVoted: false, hasLockedLp: false };
      list.push({ symbol: token.symbol, name: token.name, address: token.address, balance, valueUsd, source: 'trusted', rating: info.rating, votes: info.votes, hasVoted: info.hasVoted, hasLockedLp: info.hasLockedLp });
    }
    for (const token of savedTokens) {
      if (list.some(item => item.address === token.address)) continue;
      const balance = tokenBalances[token.address] ?? '0';
      const dec = decimalsOf(token.address);
      const price = assetPrices[token.address] ?? 0;
      const valueUsd = calculateUsdValue(balance, dec, price);
      const info = state[token.address] || { rating: 1, votes: 0, hasVoted: false, hasLockedLp: false };
      list.push({ symbol: token.symbol, name: token.name, address: token.address, balance, valueUsd, source: 'wallet', rating: info.rating, votes: info.votes, hasVoted: info.hasVoted, hasLockedLp: info.hasLockedLp });
    }
    return list.sort((a, b) => Number(b.balance) - Number(a.balance));
  }, [trustedTokens, savedTokens, tokenBalances, assetPrices, decimalsOf, calculateUsdValue, trustVoteState]);

  const totalTokens = assets.length;
  const totalPositions = lpPositions.length;
  const nativeOctUsd = (parseFloat(walletBalance || '0') || 0) * octPrice;
  const totalValueUsd = assets.reduce((sum, a) => sum + a.valueUsd, 0) + nativeOctUsd;

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

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Portfolio Value" value={totalValueUsd > 0 ? `$${totalValueUsd.toFixed(2)}` : priceLoading ? '...' : '--'} helper="Total USD value" />
        <StatCard label="Assets tracked" value={String(totalTokens)} helper="Trusted + saved tokens" />
        <StatCard label="LP positions" value={String(totalPositions)} helper="All active pools" />
        <StatCard label="Native balance" value={walletBalance || '0'} helper={`OCT in wallet${octPrice > 0 ? ` (~$${(parseFloat(walletBalance || '0') * octPrice).toFixed(2)})` : ''}`} />
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
                  onClick={() => setModal({ kind: 'asset', data: asset })}
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
                    <div className="text-xs text-[var(--app-muted)]">{asset.valueUsd > 0 ? `~$${asset.valueUsd.toFixed(2)}` : '--'}</div>
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
                  onClick={() => setModal({ kind: 'position', data: pos })}
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
                return (
                <button
                  key={tx.hash}
                  type="button"
                  onClick={() => setModal({ kind: 'activity', data: tx })}
                  className="block w-full text-left bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl p-4 hover:border-[var(--app-blue)]/40 hover:bg-[var(--app-panel)]/60 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold capitalize">{tx.type.replaceAll('_', ' ')}</div>
                      <div className="text-sm text-[var(--app-muted)]">{tx.summary}</div>
                    </div>
                    <Badge label={tx.status === 'success' ? 'Success' : 'Failed'} tone={tx.status === 'success' ? 'success' : 'danger'} />
                  </div>
                  <div className="mt-2 text-xs text-[var(--app-muted-2)] font-mono break-all underline-offset-2 group-hover:underline">{tx.hash}</div>
                </button>
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
      <PortfolioDetailModal modal={modal} onClose={() => setModal(null)} onSwap={addr => { setModal(null); navigate(`/swap?token=${encodeURIComponent(addr)}`); }} onAddLiquidity={pool => { setModal(null); navigate(`/liquidity?pool=${encodeURIComponent(pool)}`); }} onVote={handleVote} getExplorerTxUrl={getExplorerTxUrl} decimalsOf={decimalsOf} />
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

function PortfolioDetailModal({
  modal,
  onClose,
  onSwap,
  onAddLiquidity,
  onVote,
  getExplorerTxUrl,
  decimalsOf,
}: {
  modal:
    | { kind: 'asset'; data: { symbol: string; name: string; address: string; balance: string; valueUsd: number; source: string; rating: number; votes: number; hasVoted: boolean; hasLockedLp: boolean } }
    | { kind: 'position'; data: { pool: string; lp: string; tokenA: string; tokenB: string; share: number } }
    | { kind: 'activity'; data: TxRecord }
    | null;
  onClose: () => void;
  onSwap: (address: string) => void;
  onAddLiquidity: (poolAddress: string) => void;
  onVote: (address: string) => void;
  getExplorerTxUrl: (hash: string) => string;
  decimalsOf: (address: string) => number;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, onClose]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (!modal) return null;

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      // noop
    }
  };

  const explorerUrl = modal.kind === 'activity' ? getExplorerTxUrl(modal.data.hash) : '';

  const title =
    modal.kind === 'asset' ? 'Asset details'
    : modal.kind === 'position' ? 'Pool position details'
    : 'Transaction details';

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-xl z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="portfolio-modal-title"
    >
      <div
        className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] w-full max-w-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--app-border)]">
          <h3 id="portfolio-modal-title" className="text-base font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--app-muted)] hover:text-[var(--app-fg)] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-auto">
          {modal.kind === 'asset' && (() => {
            const a = modal.data;
            const dec = decimalsOf(a.address);
            return (
              <>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-semibold">{a.symbol}</span>
                    <TokenTrustBadge rating={a.rating} size="md" />
                    <Badge label={a.source === 'trusted' ? 'Trusted' : a.source === 'lp' ? 'LP' : 'Saved'} />
                  </div>
                  <div className="text-sm text-[var(--app-muted)]">{a.name}</div>
                </div>
                <Row label="Address" mono>
                  <span className="break-all">{a.address}</span>
                  <CopyButton onClick={() => copyText(a.address, 'address')} copied={copied === 'address'} />
                </Row>
                <Row label="Balance">
                  <span className="font-mono">{formatUnits(a.balance, dec)} {a.symbol}</span>
                </Row>
                 <Row label="USD value">
                   <span className="font-mono">{a.valueUsd > 0 ? `~$${a.valueUsd.toFixed(2)}` : '--'}</span>
                 </Row>
                <Row label="Decimals">
                  <span className="font-mono">{dec}</span>
                </Row>
              </>
            );
          })()}

          {modal.kind === 'position' && (() => {
            const p = modal.data;
            return (
              <>
                <div>
                  <div className="text-lg font-semibold">{p.tokenA} / {p.tokenB}</div>
                  <div className="text-sm text-[var(--app-muted)]">LP position in this pool</div>
                </div>
                <Row label="Pool address" mono>
                  <span className="break-all">{p.pool}</span>
                  <CopyButton onClick={() => copyText(p.pool, 'pool')} copied={copied === 'pool'} />
                </Row>
                <Row label="LP tokens">
                  <span className="font-mono">{formatUnits(p.lp, 12)} LP</span>
                </Row>
                <Row label="Pool share">
                  <span className="font-mono">{p.share ? p.share.toFixed(4) + '%' : '—'}</span>
                </Row>
              </>
            );
          })()}

          {modal.kind === 'activity' && (() => {
            const tx = modal.data;
            const ts = tx.timestamp ? new Date(tx.timestamp).toLocaleString() : '—';
            return (
              <>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-semibold capitalize">{tx.type.replaceAll('_', ' ')}</span>
                    <Badge label={tx.status === 'success' ? 'Success' : 'Failed'} tone={tx.status === 'success' ? 'success' : 'danger'} />
                  </div>
                  <div className="text-sm text-[var(--app-muted)]">{tx.summary}</div>
                </div>
                <Row label="Tx hash" mono>
                  <span className="break-all">{tx.hash}</span>
                  <CopyButton onClick={() => copyText(tx.hash, 'hash')} copied={copied === 'hash'} />
                </Row>
                <Row label="Time">
                  <span className="font-mono">{ts}</span>
                </Row>
                <Row label="Status">
                  <span className="font-mono capitalize">{tx.status}</span>
                </Row>
              </>
            );
          })()}
        </div>

        <div className="border-t border-[var(--app-border)] px-5 py-3 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm rounded-lg bg-[var(--app-panel-soft)] border border-[var(--app-border)] hover:border-[var(--app-blue)]/40 transition-colors"
          >
            Close
          </button>
          {modal.kind === 'asset' && (
            <>
              <button
                type="button"
                onClick={() => onSwap(modal.data.address)}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] transition-colors text-white"
              >
                Swap this token
              </button>
              {modal.data.address && modal.data.hasLockedLp && (
                <button
                  type="button"
                  onClick={() => {
                    setVoting(true);
                    onVote(modal.data.address).finally(() => setVoting(false));
                  }}
                  disabled={voting}
                  className="px-3 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-[var(--app-warning)]/80 to-[var(--app-warning)] hover:from-[var(--app-warning)] hover:to-[var(--app-warning)]/80 transition-colors text-white disabled:opacity-50"
                >
                  {voting ? '...' : modal.data.hasVoted ? `Unvote ★ ${modal.data.votes}` : `Vote ★ ${modal.data.votes}`}
                </button>
              )}
            </>
          )}
          {modal.kind === 'position' && (
            <button
              type="button"
              onClick={() => onAddLiquidity(modal.data.pool)}
              className="px-3 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] transition-colors text-white"
            >
              Add liquidity
            </button>
          )}
          {modal.kind === 'activity' && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-2 text-sm font-medium rounded-lg bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] transition-colors text-white"
            >
              View on explorer
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-[var(--app-muted-2)] font-semibold">{label}</div>
      <div className={`flex items-center gap-2 text-sm ${mono ? 'font-mono' : ''} text-[var(--app-fg)]`}>{children}</div>
    </div>
  );
}

function CopyButton({ onClick, copied }: { onClick: () => void; copied: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Copy"
      className="ml-auto shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-[var(--app-panel-soft)] border border-[var(--app-border)] hover:border-[var(--app-blue)]/40 text-[var(--app-muted)] hover:text-[var(--app-fg)] transition-colors"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
