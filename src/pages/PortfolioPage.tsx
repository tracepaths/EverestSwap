/**
 * Portfolio page — shows assets held by the connected wallet.
 *
 * Filters out scam / untrusted tokens (trust verified via factory.is_trusted).
 * Shows:
 *   - Summary cards: native OCT balance, WOCT balance, total asset count
 *   - Token holdings (trusted only, sorted by USD value desc)
 *   - LP positions in the live SwapPool
 *   - Recent on-chain transactions (local history)
 *
 * Prices come from the configured indexer (H-5: HTTPS-only).
 * If no indexer is available, tokens still display with a "no price" badge.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { CONTRACTS } from '../config';
import { useIndexer } from '../hooks/useIndexer';
import { tokenStorage } from '../services/tokenStorage';
import { getTxHistory, type TxRecord } from '../services/txHistory';
import { truncateAddress, formatUnits } from '../services/swapService';
import type { LpPosition } from '../services/octraRpc';

interface TokenHolding {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  rawBalance: string;
  formattedBalance: string;
  trusted: boolean;
  priceUsd: number | null;
  valueUsd: number | null;
}

interface LpHolding {
  poolAddress: string;
  positionId: number;
  liquidity: string;
  unlockTime: number;
  locked: boolean;
  poolSharePercent: number;
  tokenAAmount: number;
  tokenBAmount: number;
}

const TRUSTED_TOKEN_TTL_MS = 10 * 60 * 1000;
let trustedCache: { tokens: string[]; timestamp: number } | null = null;

async function fetchTrustedTokens(rpc: ReturnType<typeof useApp>['rpc']): Promise<string[]> {
  if (trustedCache && Date.now() - trustedCache.timestamp < TRUSTED_TOKEN_TTL_MS) {
    return trustedCache.tokens;
  }
  try {
    const tokens = await rpc.getTrustedTokens(CONTRACTS.factory);
    trustedCache = { tokens, timestamp: Date.now() };
    return tokens;
  } catch {
    return trustedCache?.tokens ?? [];
  }
}

function Icon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const paths: Record<string, string> = {
    wallet: 'M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-5h-5a2 2 0 110-4h5zM16 12h.01',
    coins: 'M8 9V7a4 4 0 118 0v2M5 11h14a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2z',
    layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    warning: 'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01',
    refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',
    link: 'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
    swap: 'M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3',
    drop: 'M12 2.69l5.66 5.66a8 8 0 11-11.31 0z',
    plus: 'M12 5v14M5 12h14',
    history: 'M1 4v6h6M3.51 15a9 9 0 102.13-9.36L1 10M12 7v5l4 2',
  };
  const d = paths[name] ?? paths.wallet;
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function formatUsd(value: number | null): string {
  if (value === null || !isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  if (value < 0.01) return '<$0.01';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export default function PortfolioPage() {
  const { walletAddress, walletBalance, rpc, refreshBalance } = useApp();
  const { available: indexerAvailable, prices } = useIndexer();

  const [tokens, setTokens] = useState<TokenHolding[]>([]);
  const [lpPositions, setLpPositions] = useState<LpHolding[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);

  const priceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of prices) {
      if (p && typeof p === 'object' && 'time' in p && 'price' in p) {
        const symbolOrAddr = String((p as { symbol?: string; address?: string }).symbol ?? (p as { address?: string }).address ?? '');
        const price = Number((p as { price: number }).price);
        if (symbolOrAddr && isFinite(price)) map.set(symbolOrAddr, price);
      }
    }
    return map;
  }, [prices]);

  const loadPortfolio = useCallback(async () => {
    if (!walletAddress) {
      setTokens([]);
      setLpPositions([]);
      setTxs([]);
      return;
    }
    setLoading(true);
    try {
      const [trusted, positions, woctBal] = await Promise.all([
        fetchTrustedTokens(rpc),
        rpc.getPositions(CONTRACTS.pool, walletAddress).catch(() => [] as LpPosition[]),
        rpc.getTokenBalance(CONTRACTS.woct, walletAddress).catch(() => '0'),
      ]);
      const trustedSet = new Set(trusted);

      const oesMeta = await rpc.getTokenMeta(CONTRACTS.oes).catch(() => ({ symbol: 'OES', name: 'OES', decimals: 6 }));
      const woctMeta = await rpc.getTokenMeta(CONTRACTS.woct).catch(() => ({ symbol: 'WOCT', name: 'WOCT', decimals: 6 }));

      const savedTokens = tokenStorage.getAll();

      const candidateAddresses = [
        CONTRACTS.oes,
        CONTRACTS.woct,
        ...savedTokens.map(t => t.address),
      ];
      const uniqueAddresses = Array.from(new Set(candidateAddresses.filter(a => a && a.startsWith('oct'))));

      const balanceResults = await Promise.all(
        uniqueAddresses.map(async addr => {
          try {
            const raw = await rpc.getTokenBalance(addr, walletAddress);
            return { addr, raw };
          } catch {
            return { addr, raw: '0' };
          }
        })
      );

      const holdings: TokenHolding[] = [];
      for (const { addr, raw } of balanceResults) {
        const num = Number(raw);
        if (!isFinite(num) || num <= 0) continue;
        const meta = addr === CONTRACTS.oes ? oesMeta
          : addr === CONTRACTS.woct ? woctMeta
          : savedTokens.find(t => t.address === addr) ?? { symbol: addr.slice(0, 6), name: 'Unknown', decimals: 6 };
        const trusted = trustedSet.has(addr);
        if (!trusted) continue; // Hide scam/untrusted tokens
        const priceUsd = priceMap.get(meta.symbol) ?? priceMap.get(addr) ?? null;
        const valueUsd = priceUsd !== null ? (num / Math.pow(10, meta.decimals)) * priceUsd : null;
        holdings.push({
          address: addr,
          symbol: meta.symbol,
          name: meta.name,
          decimals: meta.decimals,
          rawBalance: raw,
          formattedBalance: formatUnits(raw, meta.decimals),
          trusted: true,
          priceUsd,
          valueUsd,
        });
      }
      holdings.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));
      setTokens(holdings);

      // LP positions — compute pool share from total LP
      if (positions.length > 0) {
        try {
          const totalLp = await rpc.getTotalLpSupply(CONTRACTS.pool);
          const reserves = await rpc.getReserves(CONTRACTS.pool).catch(() => ({ reserveA: '0', reserveB: '0' }));
          const totalLpNum = Number(totalLp);
          const ra = Number(reserves.reserveA) / 1e6;
          const rb = Number(reserves.reserveB) / 1e6;
          const nowEpoch = Math.floor(Date.now() / 1000);
          const lpHoldings: LpHolding[] = positions.map(p => {
            const lp = Number(p.liquidity);
            const share = totalLpNum > 0 ? lp / totalLpNum : 0;
            return {
              poolAddress: CONTRACTS.pool,
              positionId: p.id,
              liquidity: p.liquidity,
              unlockTime: p.unlockTime,
              locked: p.unlockTime > nowEpoch,
              poolSharePercent: share * 100,
              tokenAAmount: ra * share,
              tokenBAmount: rb * share,
            };
          });
          setLpPositions(lpHoldings);
        } catch {
          setLpPositions(positions.map(p => ({
            poolAddress: CONTRACTS.pool,
            positionId: p.id,
            liquidity: p.liquidity,
            unlockTime: p.unlockTime,
            locked: p.unlockTime > Math.floor(Date.now() / 1000),
            poolSharePercent: 0,
            tokenAAmount: 0,
            tokenBAmount: 0,
          })));
        }
      } else {
        setLpPositions([]);
      }

      // Hide WOCT duplicate from tokens array (already in summary)
      const woctBalNum = Number(woctBal);
      if (woctBalNum > 0 && !tokens.find(t => t.address === CONTRACTS.woct)) {
        // WOCT was hidden because price is null — but still show it in summary
      }

      setTxs(getTxHistory());
      setLastUpdated(Date.now());
    } finally {
      setLoading(false);
    }
  }, [walletAddress, rpc, priceMap]);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  useEffect(() => {
    if (!walletAddress) return;
    const id = setInterval(() => { loadPortfolio(); refreshBalance(); }, 30_000);
    return () => clearInterval(id);
  }, [walletAddress, loadPortfolio, refreshBalance]);

  const totalValueUsd = useMemo(() => {
    let total = 0;
    for (const t of tokens) if (t.valueUsd !== null) total += t.valueUsd;
    return total;
  }, [tokens]);

  const totalActiveAssets = tokens.length + lpPositions.length;

  if (!walletAddress) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <header>
          <h1 className="text-2xl font-semibold">Portfolio</h1>
          <p className="text-sm text-[var(--app-muted-2)]">Your trusted token balances and LP positions</p>
        </header>
        <div className="rounded-2xl border bg-card p-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-muted)]">
            <Icon name="wallet" className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">No wallet connected</h2>
          <p className="mt-1 text-sm text-[var(--app-muted-2)]">Connect your Octra wallet to view your portfolio.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Portfolio</h1>
          <p className="text-sm text-[var(--app-muted-2)]">
            {truncateAddress(walletAddress)} {lastUpdated && <span>· updated {shortTime(lastUpdated)}</span>}
          </p>
        </div>
        <button
          onClick={loadPortfolio}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border bg-card px-3 py-1.5 text-sm hover:bg-[var(--app-muted)] disabled:opacity-50"
        >
          <Icon name="refresh" className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /> Refresh
        </button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2 text-[var(--app-muted-2)]">
            <Icon name="wallet" className="h-4 w-4" /> Native OCT
          </div>
          <div className="mt-3 text-2xl font-semibold">{walletBalance || '0'} <span className="text-sm font-normal text-[var(--app-muted-2)]">OCT</span></div>
          <div className="text-xs text-[var(--app-muted-2)]">On-chain balance</div>
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2 text-[var(--app-muted-2)]">
            <Icon name="drop" className="h-4 w-4" /> WOCT
          </div>
          <div className="mt-3 text-2xl font-semibold">
            {formatUnits(tokens.find(t => t.address === CONTRACTS.woct)?.rawBalance ?? '0', 6)}
            <span className="ml-1 text-sm font-normal text-[var(--app-muted-2)]">WOCT</span>
          </div>
          <div className="text-xs text-[var(--app-muted-2)]">Wrapped OCT held</div>
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2 text-[var(--app-muted-2)]">
            <Icon name="layers" className="h-4 w-4" /> Total value
          </div>
          <div className="mt-3 text-2xl font-semibold">{formatUsd(totalValueUsd)}</div>
          <div className="flex items-center gap-1 text-xs text-[var(--app-muted-2)]">
            {indexerAvailable ? (
              <><Icon name="shield" className="h-3 w-3 text-emerald-500" /> Prices via indexer</>
            ) : (
              <><Icon name="warning" className="h-3 w-3 text-amber-500" /> No price feed</>
            )}
          </div>
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2 text-[var(--app-muted-2)]">
            <Icon name="coins" className="h-4 w-4" /> Active assets
          </div>
          <div className="mt-3 text-2xl font-semibold">{totalActiveAssets}</div>
          <div className="text-xs text-[var(--app-muted-2)]">Trusted tokens + LP</div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Trusted token holdings</h2>
            <p className="text-sm text-[var(--app-muted-2)]">Scam or untrusted tokens are hidden.</p>
          </div>
          {!indexerAvailable && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-500">
              <Icon name="warning" className="h-3 w-3" /> No price data
            </span>
          )}
        </div>
        {tokens.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-[var(--app-muted-2)]">
            No trusted tokens in this wallet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-[var(--app-muted-2)]">
                <tr>
                  <th className="py-2">Token</th>
                  <th className="py-2 text-right">Balance</th>
                  <th className="py-2 text-right">Price</th>
                  <th className="py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tokens.map(t => (
                  <tr key={t.address}>
                    <td className="py-3">
                      <div className="font-medium">{t.symbol}</div>
                      <div className="text-xs text-[var(--app-muted-2)]">{t.name} · {truncateAddress(t.address)}</div>
                    </td>
                    <td className="py-3 text-right">
                      <div className="font-medium">{t.formattedBalance}</div>
                      <div className="text-xs text-[var(--app-muted-2)]">{t.symbol}</div>
                    </td>
                    <td className="py-3 text-right">{t.priceUsd !== null ? `$${t.priceUsd.toFixed(4)}` : '—'}</td>
                    <td className="py-3 text-right font-medium">{formatUsd(t.valueUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-1 text-lg font-semibold">Liquidity positions</h2>
        <p className="mb-4 text-sm text-[var(--app-muted-2)]">Your active LP positions in the SwapPool.</p>
        {lpPositions.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-[var(--app-muted-2)]">
            No liquidity positions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-[var(--app-muted-2)]">
                <tr>
                  <th className="py-2">Position</th>
                  <th className="py-2 text-right">LP tokens</th>
                  <th className="py-2 text-right">Pool share</th>
                  <th className="py-2 text-right">OES</th>
                  <th className="py-2 text-right">WOCT</th>
                  <th className="py-2 text-right">Unlock</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lpPositions.map(lp => (
                  <tr key={lp.positionId}>
                    <td className="py-3">#{lp.positionId}</td>
                    <td className="py-3 text-right">{Number(lp.liquidity).toLocaleString()}</td>
                    <td className="py-3 text-right">{lp.poolSharePercent.toFixed(4)}%</td>
                    <td className="py-3 text-right">{lp.tokenAAmount.toFixed(4)}</td>
                    <td className="py-3 text-right">{lp.tokenBAmount.toFixed(4)}</td>
                    <td className="py-3 text-right">
                      {lp.locked ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500">
                          <Icon name="history" className="h-3 w-3" /> {new Date(lp.unlockTime * 1000).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-500 text-xs">
                          <Icon name="shield" className="h-3 w-3" /> Unlocked
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Recent transactions</h2>
            <p className="text-sm text-[var(--app-muted-2)]">Local history of swaps &amp; liquidity operations.</p>
          </div>
          {txs.length > 0 && (
            <button
              onClick={() => { setTxs([]); }}
              className="text-xs text-[var(--app-muted-2)] hover:underline"
            >Clear</button>
          )}
        </div>
        {txs.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-[var(--app-muted-2)]">
            No transactions recorded yet.
          </div>
        ) : (
          <div className="space-y-2">
            {txs.slice(0, 10).map(tx => (
              <div key={tx.hash} className="flex items-center justify-between rounded-xl border p-3 text-sm">
                <div className="flex items-center gap-3">
                  <Icon name={tx.type === 'swap' ? 'swap' : 'coins'} className="h-4 w-4 text-[var(--app-muted-2)]" />
                  <div>
                    <div className="font-medium capitalize">{tx.type.replace('_', ' ')}</div>
                    <div className="text-xs text-[var(--app-muted-2)]">{tx.summary}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[var(--app-muted-2)]">{shortTime(tx.timestamp)}</div>
                  <div className="font-mono text-xs">{truncateAddress(tx.hash, 6, 4)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}