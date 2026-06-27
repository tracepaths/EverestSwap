import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { getTxHistory, type TxRecord } from '../services/txHistory';
import { tokenStorage } from '../services/tokenStorage';
import { getCachedMeta } from '../services/tokenCache';
import { MAINNET_CONFIGURED, CONTRACTS, type TokenInfo } from '../types';
import { truncateAddress } from '../services/swapService';

type AssetItem = {
  symbol: string;
  name: string;
  address: string;
  balance: string;
  valueUsd: number;
  source: 'wallet' | 'trusted' | 'lp';
};

export default function PortfolioPage() {
  const { walletAddress, isConnected, walletBalance, rpc } = useApp();

  const [trustedTokens, setTrustedTokens] = useState<TokenInfo[]>([]);
  const [savedTokens, setSavedTokens] = useState<TokenInfo[]>([]);
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});
  const [lpPositions, setLpPositions] = useState<Array<{ pool: string; lp: string; tokenA: string; tokenB: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);

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
          return pos.map(p => ({
            pool: poolAddr,
            lp: String(p.liquidity),
            tokenA: metaA?.symbol ?? poolAddr.slice(0, 6),
            tokenB: metaB?.symbol ?? poolAddr.slice(4, 10),
          }));
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

          <div className="space-y-3">
            {assets.length === 0 ? (
              <EmptyState title="No assets tracked" body="Import or trust a token to see it here." />
            ) : (
              assets.map(asset => (
                <div key={asset.address} className="bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl p-4 flex items-center justify-between gap-4 hover:border-[var(--app-blue)]/30 transition-colors">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{asset.symbol}</span>
                      <Badge label={asset.source === 'trusted' ? 'Trusted' : 'Saved'} />
                    </div>
                    <div className="text-sm text-[var(--app-muted)]">{asset.name}</div>
                    <div className="text-xs text-[var(--app-muted-2)] mt-1 font-mono">{asset.address}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{asset.balance}</div>
                    <div className="text-xs text-[var(--app-muted)]">~${asset.valueUsd.toFixed(2)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">LP positions</h2>
              <p className="text-sm text-[var(--app-muted)]">Liquidity positions owned by this wallet.</p>
            </div>
            <div className="space-y-3">
              {lpPositions.length === 0 ? (
                <EmptyState title="No LP positions" body="Create or add liquidity to see positions here." />
              ) : lpPositions.map((pos, idx) => (
                <div key={`${pos.pool}-${idx}`} className="bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{pos.tokenA} / {pos.tokenB}</div>
                      <div className="text-xs text-[var(--app-muted-2)] font-mono">{pos.pool}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{pos.lp}</div>
                      <div className="text-xs text-[var(--app-muted)]">LP tokens</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Recent activity</h2>
              <p className="text-sm text-[var(--app-muted)]">Local history of swaps and liquidity actions.</p>
            </div>
            <div className="space-y-3 max-h-[360px] overflow-auto pr-1">
              {txs.length === 0 ? (
                <EmptyState title="No recent activity" body="Your swaps and liquidity actions will appear here." />
              ) : txs.map(tx => (
                <div key={tx.hash} className="bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold capitalize">{tx.type.replaceAll('_', ' ')}</div>
                      <div className="text-sm text-[var(--app-muted)]">{tx.summary}</div>
                    </div>
                    <Badge label={tx.status === 'success' ? 'Success' : 'Failed'} tone={tx.status === 'success' ? 'success' : 'danger'} />
                  </div>
                  <div className="mt-2 text-xs text-[var(--app-muted-2)] font-mono break-all">{tx.hash}</div>
                </div>
              ))}
            </div>
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
