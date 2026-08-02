import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Routes, Route, Link, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { usePriceService } from '../hooks/usePriceService';
import { useMyPools, usePoolData } from '../hooks/usePoolData';
import { formatUnits, parseUnits, sanitizeNumericInput } from '../services/swapService';
import { walletService } from '../services/walletService';
import { CONTRACTS } from '../types';
import { recordTx } from '../services/txHistory';
import CreatePoolForm from '../components/CreatePoolForm';
import ReserveIndicator from '../components/ReserveIndicator';
import RemovePoolModal from '../components/RemovePoolModal';
import { formatAddress, isPoolRemovable, usePoolRemoval } from '../utils/poolUtils';
import type { MyPool, RemoveStep } from '../utils/poolUtils';
import type { LpPosition } from '../services/octraRpc';

interface ExtendedLpPosition extends LpPosition {
  reserveA?: string;
  reserveB?: string;
  unlocked?: boolean;
  lockTime?: number;
}

interface PoolDisplay {
  address: string;
  tokenA: string;
  tokenB: string;
  reserveA: string;
  reserveB: string;
  totalLP: string;
  totalLockedLp: string;
  symbolA: string;
  symbolB: string;
  nameA: string;
  nameB: string;
  decimalsA: number;
  decimalsB: number;
  feeTier: string;
  rewardsPerEpoch: number;
  isRewardPool: boolean;
  rewardTokenSymbol?: string;
  rewardPerEpoch?: string;
}

type AddLiquidityStep =
  | { type: 'idle' }
  | { type: 'granting_a' }
  | { type: 'granting_b' }
  | { type: 'adding_liquidity' }
  | { type: 'done'; txHash: string }
  | { type: 'error'; message: string };

type RemoveLiquidityStep =
  | { type: 'idle' }
  | { type: 'removing' }
  | { type: 'done'; txHash: string }
  | { type: 'error'; message: string };

type Tab = 'browse' | 'my-pools' | 'liquidity';

interface DynamicPool {
  address: string;
  tokenA: { address: string; symbol: string; name: string; decimals: number };
  tokenB: { address: string; symbol: string; name: string; decimals: number };
  label: string;
}

function BrowsePools({ onPoolSelect }: { onPoolSelect: (address: string) => void }) {
  const { rpc } = useApp();
  const { getTokenUsd, octPrice } = usePriceService(rpc);
  const [pools, setPools] = useState<PoolDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [poolPrices, setPoolPrices] = useState<Record<string, { priceA: number; priceB: number; tvlUsd: number }>>({});
  const mountedRef = useRef(true);

  const loadPools = useCallback(async () => {
    setLoading(true);
    try {
      const poolAddrs = await rpc.getAllPools(CONTRACTS.factory);
      if (CONTRACTS.pool && !poolAddrs.includes(CONTRACTS.pool)) {
        poolAddrs.push(CONTRACTS.pool);
      }

      let rewardPoolAddrs: string[] = [];
      try {
        rewardPoolAddrs = await rpc.getRewardPools(CONTRACTS.factory);
      } catch { /* noop */ }

      const displays: PoolDisplay[] = [];
      for (const addr of poolAddrs) {
        try {
          const info = await rpc.getPoolInfo(addr);
          if (!info.tokenA || !info.tokenB) continue;
          const [metaA, metaB, feeParams] = await Promise.all([
            rpc.getTokenMeta(info.tokenA),
            rpc.getTokenMeta(info.tokenB),
            rpc.getPoolFeeParams(addr),
          ]);
          if (!metaA.symbol || metaA.symbol === '???') continue;
          if (!metaB.symbol || metaB.symbol === '???') continue;
          let rewardsPerEpoch = 0;
          try {
            const oesAddr = CONTRACTS.oes;
            if (oesAddr) {
              const rewardsInfo = await rpc.getOesRewardsInfo(oesAddr);
              rewardsPerEpoch = rewardsInfo.rewardsPerEpoch;
            }
          } catch { /* noop */ }
          let totalLockedLp = '0';
          try {
            totalLockedLp = await rpc.getTotalLockedLp(addr);
          } catch { /* noop */ }

          const isRewardPool = rewardPoolAddrs.includes(addr);
          let rewardTokenSymbol = '';
          let rewardPerEpoch = 0;
          if (isRewardPool) {
            try {
              const rewardInfo = await rpc.getRewardInfo(addr);
              const rewardMeta = await rpc.getTokenMeta(rewardInfo.rewardToken);
              rewardTokenSymbol = rewardMeta.symbol || '???';
              if (rewardInfo.rewardEndEpoch > rewardInfo.rewardStartEpoch) {
                const totalEpochs = rewardInfo.rewardEndEpoch - rewardInfo.rewardStartEpoch;
                const rawAmount = BigInt(rewardInfo.rewardTotal);
                rewardPerEpoch = Number(rawAmount / BigInt(totalEpochs));
              }
            } catch { /* noop */ }
          }

          displays.push({
            address: addr,
            tokenA: info.tokenA, tokenB: info.tokenB,
            reserveA: info.reserveA, reserveB: info.reserveB,
            totalLP: info.totalLP,
            totalLockedLp,
            symbolA: metaA.symbol, symbolB: metaB.symbol,
            nameA: metaA.name, nameB: metaB.name,
            decimalsA: metaA.decimals, decimalsB: metaB.decimals,
            feeTier: feeParams.percent,
            rewardsPerEpoch,
            isRewardPool,
            rewardTokenSymbol,
            rewardPerEpoch: String(rewardPerEpoch),
          });
        } catch {
          // skip this pool
        }
      }
      if (mountedRef.current) setPools(displays);
    } catch {
      if (mountedRef.current) setPools([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    mountedRef.current = true;
    loadPools();
    return () => { mountedRef.current = false; };
  }, [loadPools]);

  useEffect(() => {
    let cancelled = false;
    async function fetchPoolPrices() {
      const prices: Record<string, { priceA: number; priceB: number; tvlUsd: number }> = {};
      for (const p of pools) {
        const [priceA, priceB] = await Promise.all([
          getTokenUsd(p.tokenA),
          getTokenUsd(p.tokenB),
        ]);
        const humanA = parseFloat(formatUnits(p.reserveA, p.decimalsA));
        const humanB = parseFloat(formatUnits(p.reserveB, p.decimalsB));
        const tvlUsd = (Number.isFinite(humanA) ? humanA : 0) * priceA
                     + (Number.isFinite(humanB) ? humanB : 0) * priceB;
        prices[p.address] = { priceA, priceB, tvlUsd };
      }
      if (!cancelled && mountedRef.current) setPoolPrices(prices);
    }
    if (pools.length > 0) fetchPoolPrices();
    return () => { cancelled = true; };
  }, [pools, getTokenUsd]);

  const totalLPAll = pools.reduce((sum, p) => {
    try { return sum + BigInt(p.totalLP); } catch { return sum; }
  }, 0n);

  return (
    <div className="page-surface mx-auto w-full max-w-5xl pt-1 sm:pt-3 space-y-5">
      <div className="page-heading">
        <div>
          <div className="page-kicker">EverestSwap markets</div>
          <h1 className="page-title">Pools</h1>
          <p className="page-subtitle">Explore available liquidity and route your next trade.</p>
        </div>
        <button onClick={loadPools} className="page-action">Refresh</button>
      </div>

      <div className="page-panel overflow-hidden">
        <div className="page-panel-header">
          <div>
            <h2 className="page-panel-title">Active pools</h2>
            <p className="page-panel-copy">Live reserves, fee tiers, and locked liquidity.</p>
          </div>
          <span className="swap-live-label">
            <span className="status-dot" />{pools.length} tracked
          </span>
        </div>
        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-24 bg-[var(--app-panel-soft)] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : pools.length === 0 ? (
            <div className="text-center py-8 text-sm text-[var(--app-muted)]">No pools found</div>
          ) : (
            <div className="bg-[var(--app-panel-soft)] rounded-xl border border-[var(--app-border)] divide-y divide-white/10">
              {pools.map(p => (
                <button
                  key={p.address}
                  onClick={() => onPoolSelect(p.address)}
                  className="w-full p-4 text-left hover:bg-[var(--app-hover)] transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex -space-x-2">
                        <div className="w-8 h-8 rounded-full bg-[var(--app-blue)] flex items-center justify-center text-xs font-bold border-2 border-[var(--app-bg)]">{p.symbolA[0] || '?'}</div>
                        <div className="w-8 h-8 rounded-full bg-[var(--app-blue-2)] flex items-center justify-center text-xs font-bold border-2 border-[var(--app-bg)]">{p.symbolB[0] || '?'}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.symbolA}/{p.symbolB}</span>
                          {p.isRewardPool && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                              REWARD
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--app-muted)]">{p.feeTier} fee tier</div>
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="font-mono">{formatUnits(p.totalLP, 12)} LP</div>
                      <div className="text-xs text-[var(--app-muted)]">Total Liquidity</div>
                      {poolPrices[p.address] && poolPrices[p.address].tvlUsd > 0 && (
                        <div className="text-xs font-mono text-[var(--app-blue)]">{'~$' + poolPrices[p.address].tvlUsd.toFixed(2)}</div>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-4 text-sm">
                    <div>
                      <div className="text-xs text-[var(--app-muted)]">{p.symbolA} Reserve</div>
                      <div className="font-mono mt-0.5">{formatUnits(p.reserveA, p.decimalsA)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--app-muted)]">{p.symbolB} Reserve</div>
                      <div className="font-mono mt-0.5">{formatUnits(p.reserveB, p.decimalsB)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--app-muted)]">Fee</div>
                      <div className="font-mono mt-0.5">{p.feeTier}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--app-muted)]">OES Rewards</div>
                      <div className="font-mono mt-0.5">{p.rewardsPerEpoch > 0 ? `${formatUnits(String(p.rewardsPerEpoch), 6)}/ep` : '--'}</div>
                    </div>
                    {p.isRewardPool && p.rewardTokenSymbol && (
                      <div className="col-span-2 sm:col-span-4 pt-2 border-t border-[var(--app-border)]">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-green-400 font-medium">Custom Reward:</span>
                          <span className="font-mono text-green-400/80">
                            {p.rewardPerEpoch ? `${formatUnits(String(p.rewardPerEpoch), 12)} ${p.rewardTokenSymbol}/epoch` : 'Configured'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  {Number(p.totalLockedLp) > 0 && (
                    <div className="mt-3 flex items-center gap-3 text-xs">
                      <div className="flex-1 bg-[var(--app-panel)] rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-[var(--app-blue)] rounded-full"
                          style={{ width: `${Math.min(100, (Number(p.totalLockedLp) / Number(p.totalLP)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[var(--app-muted)] whitespace-nowrap">
                        🔒 {formatUnits(p.totalLockedLp, 12)} LP locked
                      </span>
                      <span className="text-[var(--app-muted)] whitespace-nowrap">
                        🔓 {formatUnits((BigInt(p.totalLP) - BigInt(p.totalLockedLp)).toString(), 12)} LP unlocked
                      </span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="page-panel p-4 sm:p-5">
        <h3 className="text-sm font-semibold mb-3">Pool Analytics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-[var(--app-muted)]">Total Pools</div>
            <div className="font-medium mt-0.5">{pools.length}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--app-muted)]">Total Liquidity</div>
            <div className="font-medium mt-0.5">{formatUnits(totalLPAll.toString(), 12)} LP</div>
          </div>
          <div>
            <div className="text-xs text-[var(--app-muted)]">OCT Price</div>
            <div className="font-medium mt-0.5 font-mono">{octPrice > 0 ? `$${octPrice.toFixed(4)}` : '...'}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--app-muted)]">Total Pools TVL</div>
            <div className="font-medium mt-0.5">
              {Object.values(poolPrices).reduce((s, v) => s + v.tvlUsd, 0) > 0
                ? `~$${Object.values(poolPrices).reduce((s, v) => s + v.tvlUsd, 0).toFixed(2)}`
                : '...'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MyPoolsList({ onPoolSelect }: { onPoolSelect: (address: string) => void }) {
  const { myPools, loading, loadMyPools } = useMyPools();
  const { addToast, isConnected, rpc, connect, walletAddress } = useApp();
  const [removeStep, setRemoveStep] = useState<RemoveStep>({ type: 'idle' });
  const [selectedPool, setSelectedPool] = useState<MyPool | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const { removePool } = usePoolRemoval(addToast, () => {
    loadMyPools();
  });

  const handleRemove = async (confirmTextParam: string) => {
    if (!selectedPool) return { type: 'error' as const, message: 'No pool selected' };
    const result = await removePool(selectedPool.address, confirmTextParam);
    setRemoveStep(result);
    if (result.type === 'done') {
      setShowConfirm(false);
      setSelectedPool(null);
    }
    return result;
  };

  if (!isConnected) {
    return (
      <div className="page-surface mx-auto w-full max-w-5xl pt-1 sm:pt-3">
        <div className="page-heading">
          <div>
            <div className="page-kicker">My Pools</div>
            <h1 className="page-title">Pools You Own</h1>
            <p className="page-subtitle">Connect your wallet to view pools you've created.</p>
          </div>
        </div>
        <div className="page-panel p-8 text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-bold text-[var(--app-text)] mb-2">Wallet Not Connected</h2>
          <p className="text-sm text-[var(--app-muted)] mb-4">Connect your wallet to see your pools.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-surface mx-auto w-full max-w-5xl pt-1 sm:pt-3 space-y-5">
      <div className="page-heading">
        <div>
          <div className="page-kicker">My Pools</div>
          <h1 className="page-title">Pools You Own</h1>
          <p className="page-subtitle">Manage and remove pools you've created.</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="page-action">
          {showCreate ? 'Close builder' : 'Create pool'}
        </button>
      </div>

      {showCreate && (
        <CreatePoolForm
          rpc={rpc}
          isConnected={isConnected}
          onPoolCreated={loadMyPools}
          connect={connect}
          walletAddress={walletAddress}
        />
      )}

      {myPools.length > 0 && (
        <div className="page-panel p-4 text-sm text-[var(--app-muted)]">
          <span className="font-medium text-[var(--app-warning)]">ℹ</span> Pools with zero reserves and zero LP tokens can be safely removed from the factory.
        </div>
      )}

      <div className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 bg-[var(--app-panel-soft)] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : myPools.length === 0 ? (
          <div className="page-panel p-8 text-center">
            <div className="text-5xl mb-4">🏊</div>
            <h2 className="text-xl font-bold text-[var(--app-text)] mb-2">No Pools Found</h2>
            <p className="text-sm text-[var(--app-muted)]">You don't own any pools yet.</p>
          </div>
        ) : (
          myPools.map(pool => (
            <div key={pool.address} className="page-panel p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold text-white border-2 border-[var(--app-bg)]">
                      {pool.symbolA.slice(0, 1)}
                    </div>
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-sm font-bold text-white border-2 border-[var(--app-bg)]">
                      {pool.symbolB.slice(0, 1)}
                    </div>
                  </div>
                  <div>
                    <div className="font-bold text-[var(--app-text)]">{pool.symbolA} / {pool.symbolB}</div>
                    <div className="text-xs text-[var(--app-muted)] font-mono">{formatAddress(pool.address)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${pool.active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {pool.active ? 'Active' : 'Paused'}
                  </span>
                  <span className="text-xs text-[var(--app-muted)] bg-[var(--app-panel-soft)] px-3 py-1 rounded-lg">
                    Fee: {((pool.feeNum / pool.feeDenom) * 100).toFixed(2)}%
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <ReserveIndicator value={pool.reserveA} label="Reserve A" />
                <ReserveIndicator value={pool.reserveB} label="Reserve B" />
                <ReserveIndicator value={pool.totalLp} label="Total LP" />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => onPoolSelect(pool.address)}
                  className="text-sm text-[var(--app-blue)] hover:text-[var(--app-blue-hover)] font-medium"
                >
                  View Details →
                </button>
                <button
                  disabled={!isPoolRemovable(pool)}
                  onClick={() => { setSelectedPool(pool); setShowConfirm(true); setRemoveStep({ type: 'idle' }); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${isPoolRemovable(pool)
                    ? 'bg-red-600/90 hover:bg-red-600 text-white cursor-pointer shadow-lg shadow-red-900/30'
                    : 'bg-[var(--app-panel-soft)] text-[var(--app-muted)] cursor-not-allowed opacity-50'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Remove Pool
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showConfirm && selectedPool && (
        <RemovePoolModal
          pool={selectedPool}
          isOpen={showConfirm}
          onClose={() => { setShowConfirm(false); setSelectedPool(null); }}
          onConfirm={handleRemove}
          removeStep={removeStep}
        />
      )}
    </div>
  );
}

function LiquidityTab() {
  const { rpc, isConnected, walletAddress, addToast, refreshBalance } = useApp();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<'add' | 'remove'>('add');
  const [pools, setPools] = useState<DynamicPool[]>([]);
  const [selectedPoolIdx, setSelectedPoolIdx] = useState(0);
  const [showPoolSelect, setShowPoolSelect] = useState(false);
  const [poolQuery, setPoolQuery] = useState('');
  const [poolLoading, setPoolLoading] = useState(true);
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [reserveA, setReserveA] = useState('0');
  const [reserveB, setReserveB] = useState('0');
  const [totalLP, setTotalLP] = useState('0');
  const [lpBalance, setLpBalance] = useState('0');
  const [positions, setPositions] = useState<ExtendedLpPosition[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [tokenABalance, setTokenABalance] = useState('0');
  const [tokenBBalance, setTokenBBalance] = useState('0');
  const [lockOption, setLockOption] = useState<'unlocked' | '30d' | '6m' | '1y' | 'custom'>('unlocked');
  const [customLockDays, setCustomLockDays] = useState<string>('');
  const [userEditedB, setUserEditedB] = useState(false);
  const [addStep, setAddStep] = useState<AddLiquidityStep>({ type: 'idle' });
  const [removeStep, setRemoveStep] = useState<RemoveLiquidityStep>({ type: 'idle' });
  const [isRewardPool, setIsRewardPool] = useState(false);
  const [rewardTokenSymbol, setRewardTokenSymbol] = useState('');
  const [rewardTokenDecimals, setRewardTokenDecimals] = useState(6);
  const [claimableReward, setClaimableReward] = useState('0');
  const [claimingReward, setClaimingReward] = useState(false);

  const pool = pools[selectedPoolIdx];
  const mountedRef = useRef(true);
  const poolSearchRef = useRef<HTMLInputElement>(null);
  const addSubmittingRef = useRef(false);
  const removeSubmittingRef = useRef(false);

  useEffect(() => {
    if (showPoolSelect) {
      setTimeout(() => poolSearchRef.current?.focus(), 100);
    } else {
      setPoolQuery('');
    }
  }, [showPoolSelect]);

  useEffect(() => {
    if (!isConnected || !walletAddress) return;
    let cancelled = false;
    (async () => {
      setPoolLoading(true);
      try {
        const poolAddrs = await rpc.getAllPools(CONTRACTS.factory);
        if (CONTRACTS.pool && !poolAddrs.includes(CONTRACTS.pool)) poolAddrs.push(CONTRACTS.pool);
        const dynamicPools: DynamicPool[] = [];
        for (const addr of poolAddrs) {
          try {
            const info = await rpc.getPoolInfo(addr);
            if (!info.tokenA || !info.tokenB) continue;
            const [metaA, metaB] = await Promise.all([
              rpc.getTokenMeta(info.tokenA),
              rpc.getTokenMeta(info.tokenB),
            ]);
            if (!metaA.symbol || metaA.symbol === '???') continue;
            if (!metaB.symbol || metaB.symbol === '???') continue;
            dynamicPools.push({
              address: addr,
              tokenA: { address: info.tokenA, symbol: metaA.symbol, name: metaA.name, decimals: metaA.decimals },
              tokenB: { address: info.tokenB, symbol: metaB.symbol, name: metaB.name, decimals: metaB.decimals },
              label: `${metaA.symbol}/${metaB.symbol}`,
            });
          } catch { /* skip */ }
        }
        if (!cancelled && mountedRef.current) setPools(dynamicPools);
      } catch {
        if (!cancelled && mountedRef.current) setPools([]);
      } finally {
        if (!cancelled && mountedRef.current) setPoolLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rpc, isConnected, walletAddress]);

  useEffect(() => {
    const poolAddr = searchParams.get('pool');
    if (poolAddr && pools.length > 0) {
      const idx = pools.findIndex(p => p.address === poolAddr);
      if (idx >= 0) setSelectedPoolIdx(idx);
    }
  }, [searchParams, pools]);

  useEffect(() => {
    if (!pool || !isConnected || !walletAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const [reserves, totalLpVal, lpBal, positionsData, balanceA, balanceB] = await Promise.all([
          rpc.getReserves(pool.address),
          rpc.getTotalLpSupply(pool.address),
          rpc.getLpBalance(pool.address, walletAddress),
          rpc.getPositions(pool.address, walletAddress),
          rpc.getTokenBalance(pool.tokenA.address, walletAddress),
          rpc.getTokenBalance(pool.tokenB.address, walletAddress),
        ]);
        if (!cancelled && mountedRef.current) {
          setReserveA(reserves.reserveA);
          setReserveB(reserves.reserveB);
          setTotalLP(totalLpVal);
          setLpBalance(lpBal);
          setPositions(positionsData);
          setTokenABalance(balanceA);
          setTokenBBalance(balanceB);
        }

        try {
          const oesAddr = CONTRACTS.oes;
          if (oesAddr) {
            await rpc.getOesRewardsInfo(oesAddr);
          }
        } catch { /* noop */ }

        try {
          await rpc.getTotalLockedLp(pool.address);
        } catch { /* noop */ }

        try {
          const rewardInfo = await rpc.getRewardInfo(pool.address);
          if (!cancelled && mountedRef.current) {
            setIsRewardPool(true);
            const rewardMeta = await rpc.getTokenMeta(rewardInfo.rewardToken);
            setRewardTokenSymbol(rewardMeta.symbol || '???');
            setRewardTokenDecimals(rewardMeta.decimals || 6);
          }
            try {
              const claimable = await rpc.getClaimable(pool.address, 0);
              if (!cancelled && mountedRef.current) setClaimableReward(claimable);
            } catch { /* noop */ }
        } catch {
          if (!cancelled && mountedRef.current) setIsRewardPool(false);
        }
      } catch (err) {
        console.error('Failed to load pool data:', err);
      }
    })();

    const interval = setInterval(() => {
      if (!pool || !isConnected || !walletAddress) return;
      (async () => {
        try {
          const [reserves, totalLpVal, lpBal, positionsData] = await Promise.all([
            rpc.getReserves(pool.address),
            rpc.getTotalLpSupply(pool.address),
            rpc.getLpBalance(pool.address, walletAddress),
            rpc.getPositions(pool.address, walletAddress),
          ]);
          if (mountedRef.current) {
            setReserveA(reserves.reserveA);
            setReserveB(reserves.reserveB);
            setTotalLP(totalLpVal);
            setLpBalance(lpBal);
            setPositions(positionsData);
          }
        } catch { /* noop */ }
      })();
    }, 10000);

    return () => clearInterval(interval);
  }, [pool, isConnected, walletAddress, rpc]);

  const poolShare = useMemo(() => {
    try {
      if (BigInt(totalLP) === 0n) return '0';
      const share = (BigInt(lpBalance) * 10000n) / BigInt(totalLP);
      return (Number(share) / 100).toFixed(2);
    } catch { return '0'; }
  }, [lpBalance, totalLP]);

  const selectedPosition = useMemo(() => {
    if (!selectedPositionId) return null;
    return positions.find(p => p.id === selectedPositionId) || null;
  }, [positions, selectedPositionId]);

  const handleAddLiquidity = async () => {
    if (!pool || !isConnected || !walletAddress) return;
    if (addSubmittingRef.current) return;
    addSubmittingRef.current = true;
    setAddStep({ type: 'granting_a' });

    const safeSetStep = (s: AddLiquidityStep) => {
      if (mountedRef.current) setAddStep(s);
    };

    try {
      const amountAInt = BigInt(parseUnits(amountA, pool.tokenA.decimals));
      const amountBInt = BigInt(parseUnits(amountB, pool.tokenB.decimals));

      if (amountAInt <= 0n || amountBInt <= 0n) {
        safeSetStep({ type: 'error', message: 'Amounts must be greater than 0' });
        addSubmittingRef.current = false;
        return;
      }

      if (amountAInt > BigInt(tokenABalance)) {
        safeSetStep({ type: 'error', message: `Insufficient ${pool.tokenA.symbol} balance` });
        addSubmittingRef.current = false;
        return;
      }
      if (amountBInt > BigInt(tokenBBalance)) {
        safeSetStep({ type: 'error', message: `Insufficient ${pool.tokenB.symbol} balance` });
        addSubmittingRef.current = false;
        return;
      }

      const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
      const deadline = epochInfo.epoch_id + 300;

      let lockBlocks = 0;
      if (lockOption === '30d') lockBlocks = 30 * 1440;
      else if (lockOption === '6m') lockBlocks = 180 * 1440;
      else if (lockOption === '1y') lockBlocks = 365 * 1440;
      else if (lockOption === 'custom') {
        const days = parseInt(customLockDays, 10);
        if (isNaN(days) || days <= 0) {
          safeSetStep({ type: 'error', message: 'Invalid custom lock duration' });
          addSubmittingRef.current = false;
          return;
        }
        lockBlocks = days * 1440;
      }

      safeSetStep({ type: 'granting_a' });
      const grantAHash = await walletService.callContract({
        contract: pool.tokenA.address,
        method: 'grant',
        params: [pool.address, Number(amountAInt)],
        rpc,
      });
      await rpc.waitForReceipt(grantAHash);

      safeSetStep({ type: 'granting_b' });
      const grantBHash = await walletService.callContract({
        contract: pool.tokenB.address,
        method: 'grant',
        params: [pool.address, Number(amountBInt)],
        rpc,
      });
      await rpc.waitForReceipt(grantBHash);

      safeSetStep({ type: 'adding_liquidity' });
      // [FIX] PoolPage add_liquidity parameter order must match contract:
      // add_liquidity(amount_a, amount_b, min_lp, deadline, lock_duration)
      // Previously lockBlocks was passed as min_lp (always 0) and 0 as lock_duration,
      // meaning positions were never actually locked despite user's choice.
      const minLp = 0;
      const addLiqHash = await walletService.callContract({
        contract: pool.address,
        method: 'add_liquidity',
        params: [amountAInt.toString(), amountBInt.toString(), minLp, deadline, lockBlocks],
        rpc,
      });
      await rpc.waitForReceipt(addLiqHash);
      safeSetStep({ type: 'done', txHash: addLiqHash });
      addToast('success', 'Liquidity added successfully');
      recordTx({ hash: addLiqHash, type: 'add_liquidity', summary: 'Add liquidity to ' + pool.address, timestamp: Date.now(), status: 'success' });
      refreshBalance();
      setAmountA('');
      setAmountB('');
      setUserEditedB(false);
      setTimeout(() => {
        if (mountedRef.current) safeSetStep({ type: 'idle' });
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Add liquidity failed';
      safeSetStep({ type: 'error', message: msg });
      addToast('error', `Add liquidity failed: ${msg}`);
    } finally {
      addSubmittingRef.current = false;
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!pool || !isConnected || !walletAddress || !selectedPosition) return;
    if (removeSubmittingRef.current) return;
    removeSubmittingRef.current = true;
    setRemoveStep({ type: 'removing' });

    try {
      const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
      const deadline = epochInfo.epoch_id + 300;

      // [FIX] Validate that the position is unlocked before submitting on-chain.
      // Previously the user could pick a still-locked position in the dropdown
      // and only discover the revert after paying gas. Mirror the displayed
      // `unlocked` flag to fail fast here.
      if (!selectedPosition.unlocked) {
        throw new Error(`Position #${selectedPosition.id} is still locked (unlocks in ${selectedPosition.lockTime ?? 0} blocks)`);
      }

      const removeHash = await walletService.callContract({
        contract: pool.address,
        method: 'remove_liquidity',
        params: [selectedPosition.id, 0, 0, deadline],
        rpc,
      });
      await rpc.waitForReceipt(removeHash);
      setRemoveStep({ type: 'done', txHash: removeHash });
      addToast('success', 'Liquidity removed successfully');
      recordTx({ hash: removeHash, type: 'remove_liquidity', summary: 'Remove liquidity from ' + pool.address, timestamp: Date.now(), status: 'success' });
      refreshBalance();
      setSelectedPositionId(null);
      setTimeout(() => {
        if (mountedRef.current) setRemoveStep({ type: 'idle' });
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remove failed';
      setRemoveStep({ type: 'error', message: msg });
      addToast('error', `Remove failed: ${msg}`);
    } finally {
      removeSubmittingRef.current = false;
    }
  };

  // [UX] Close all unlocked positions in one button to save multiple confirmations.
  // NOTE: Each call to remove_liquidity closes ONE position (contract has no
  // partial-amount parameter). For "remove sebagian" add liquidity as multiple
  // positions and remove one. This helper simply batches those per-position
  // closures using the contract's close_position(min_a, min_b, deadline) method,
  // which auto-picks the first unlocked position for the caller.
  const [closingAll, setClosingAll] = useState(false);
  const handleCloseAllUnlocked = async () => {
    if (!pool || !isConnected || !walletAddress) return;
    const unlockedCount = positions.filter(p => p.unlocked).length;
    if (unlockedCount === 0) {
      addToast('error', 'No unlocked positions to remove');
      return;
    }
    if (removeSubmittingRef.current) return;
    removeSubmittingRef.current = true;
    setClosingAll(true);
    setRemoveStep({ type: 'removing' });

    try {
      let successCount = 0;
      let lastHash = '';
      // Loop: each call closes exactly one unlocked position.
      for (let i = 0; i < unlockedCount; i++) {
        const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
        const deadline = epochInfo.epoch_id + 300;
        const hash = await walletService.callContract({
          contract: pool.address,
          method: 'close_position',
          params: [0, 0, deadline],
          rpc,
        });
        await rpc.waitForReceipt(hash);
        lastHash = hash;
        successCount += 1;
      }
      setRemoveStep({ type: 'done', txHash: lastHash });
      addToast('success', `Closed ${successCount} position${successCount > 1 ? 's' : ''}`);
      if (lastHash) recordTx({ hash: lastHash, type: 'remove_liquidity', summary: `Close all unlocked from ${pool.address}`, timestamp: Date.now(), status: 'success' });
      refreshBalance();
      setSelectedPositionId(null);
      setTimeout(() => {
        if (mountedRef.current) setRemoveStep({ type: 'idle' });
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Close all failed';
      setRemoveStep({ type: 'error', message: msg });
      addToast('error', `Close all failed: ${msg}`);
    } finally {
      removeSubmittingRef.current = false;
      setClosingAll(false);
    }
  };

  const handleClaimReward = async () => {
    if (!pool || !isConnected || !walletAddress) return;
    setClaimingReward(true);
    try {
      const hash = await walletService.callContract({
        contract: pool.address,
        method: 'claim_reward',
        params: [],
        rpc,
      });
      await rpc.waitForReceipt(hash);
      addToast('success', 'Reward claimed successfully');
      recordTx({ hash, type: 'claim', summary: 'Claim reward from ' + pool.address, timestamp: Date.now(), status: 'success' });
      refreshBalance();
      setClaimableReward('0');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Claim failed';
      addToast('error', `Claim failed: ${msg}`);
    } finally {
      setClaimingReward(false);
    }
  };

  const handleAmountAChange = (val: string) => {
    setAmountA(val);
    if (!userEditedB && val) {
      try {
        const amountAInt = BigInt(parseUnits(val, pool.tokenA.decimals));
        if (BigInt(reserveA) > 0n && BigInt(reserveB) > 0n) {
          const amountBInt = (amountAInt * BigInt(reserveB)) / BigInt(reserveA);
          const amountBStr = formatUnits(amountBInt.toString(), pool.tokenB.decimals);
          setAmountB(amountBStr);
        }
      } catch { /* noop */ }
    }
  };

  const handleAmountBChange = (val: string) => {
    setAmountB(val);
    setUserEditedB(true);
  };

  if (!isConnected) {
    return (
      <div className="page-surface mx-auto w-full max-w-5xl pt-1 sm:pt-3">
        <div className="page-heading">
          <div>
            <div className="page-kicker">Liquidity</div>
            <h1 className="page-title">Add / Remove Liquidity</h1>
            <p className="page-subtitle">Provide liquidity to earn trading fees.</p>
          </div>
        </div>
        <div className="page-panel p-8 text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-bold text-[var(--app-text)] mb-2">Wallet Not Connected</h2>
          <p className="text-sm text-[var(--app-muted)] mb-4">Connect your wallet to manage liquidity.</p>
        </div>
      </div>
    );
  }

  if (poolLoading) {
    return (
      <div className="page-surface mx-auto w-full max-w-5xl pt-1 sm:pt-3">
        <div className="page-heading">
          <div>
            <div className="page-kicker">Liquidity</div>
            <h1 className="page-title">Add / Remove Liquidity</h1>
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-[var(--app-panel-soft)] rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="page-surface mx-auto w-full max-w-5xl pt-1 sm:pt-3">
        <div className="page-heading">
          <div>
            <div className="page-kicker">Liquidity</div>
            <h1 className="page-title">Add / Remove Liquidity</h1>
            <p className="page-subtitle">Provide liquidity to earn trading fees.</p>
          </div>
          <button onClick={() => setShowPoolSelect(true)} className="page-action">Select Pool</button>
        </div>
        <div className="page-panel p-8 text-center">
          <div className="text-5xl mb-4">🏊</div>
          <h2 className="text-xl font-bold text-[var(--app-text)] mb-2">No Pool Selected</h2>
          <p className="text-sm text-[var(--app-muted)] mb-4">Select a pool to add or remove liquidity.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-surface mx-auto w-full max-w-5xl pt-1 sm:pt-3 space-y-5">
      <div className="page-heading">
        <div>
          <div className="page-kicker">Liquidity</div>
          <h1 className="page-title">Add / Remove Liquidity</h1>
          <p className="page-subtitle">
            {pool.label} — {tab === 'add' ? 'Add liquidity' : 'Remove liquidity'}
          </p>
        </div>
        <button onClick={() => setShowPoolSelect(true)} className="page-action">Change Pool</button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('add')}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${tab === 'add' ? 'bg-[var(--app-blue)] text-white' : 'bg-[var(--app-panel-soft)] text-[var(--app-muted)] hover:bg-[var(--app-hover)]'}`}
        >
          Add Liquidity
        </button>
        <button
          onClick={() => setTab('remove')}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${tab === 'remove' ? 'bg-[var(--app-blue)] text-white' : 'bg-[var(--app-panel-soft)] text-[var(--app-muted)] hover:bg-[var(--app-hover)]'}`}
        >
          Remove Liquidity
        </button>
      </div>

      <div className="page-panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white">
                {pool.tokenA.symbol[0]}
              </div>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center text-xs font-bold text-white">
                {pool.tokenB.symbol[0]}
              </div>
            </div>
            <div>
              <div className="font-bold text-[var(--app-text)]">{pool.tokenA.symbol} / {pool.tokenB.symbol}</div>
              <div className="text-xs text-[var(--app-muted)] font-mono">{formatAddress(pool.address)}</div>
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-mono">{formatUnits(totalLP, 12)} LP</div>
            <div className="text-xs text-[var(--app-muted)]">Total LP</div>
            <div className="text-xs text-[var(--app-muted)]">Your share: {poolShare}%</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <ReserveIndicator value={reserveA} label={`${pool.tokenA.symbol} Reserve`} />
          <ReserveIndicator value={reserveB} label={`${pool.tokenB.symbol} Reserve`} />
          <ReserveIndicator value={lpBalance} label="Your LP" />
        </div>

        {tab === 'add' && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-[var(--app-muted)] mb-1">
                <span>{pool.tokenA.symbol} Amount</span>
                <span>Balance: {formatUnits(tokenABalance, pool.tokenA.decimals)}</span>
              </div>
              <input
                type="number"
                value={amountA}
                onChange={e => handleAmountAChange(sanitizeNumericInput(e.target.value))}
                placeholder="0.00"
                className="w-full bg-[var(--app-input)] border border-[var(--app-border)] text-[var(--app-text)] rounded-xl px-4 py-3 text-lg outline-none focus:border-[var(--app-blue)] transition-colors"
              />
              <div className="flex gap-1 mt-2">
                {['25', '50', '75', '100'].map(pct => (
                  <button
                    key={pct}
                    onClick={() => {
                      const pctNum = Number(pct);
                      const bal = BigInt(tokenABalance);
                      const amt = (bal * BigInt(pctNum)) / 100n;
                      const amtStr = formatUnits(amt.toString(), pool.tokenA.decimals);
                      handleAmountAChange(amtStr);
                    }}
                    className="flex-1 py-1.5 text-xs font-semibold bg-[var(--app-panel-soft)] rounded-lg hover:bg-[var(--app-hover)] transition-colors"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-[var(--app-muted)] mb-1">
                <span>{pool.tokenB.symbol} Amount</span>
                <span>Balance: {formatUnits(tokenBBalance, pool.tokenB.decimals)}</span>
              </div>
              <input
                type="number"
                value={amountB}
                onChange={e => handleAmountBChange(sanitizeNumericInput(e.target.value))}
                placeholder="0.00"
                className="w-full bg-[var(--app-input)] border border-[var(--app-border)] text-[var(--app-text)] rounded-xl px-4 py-3 text-lg outline-none focus:border-[var(--app-blue)] transition-colors"
              />
              <div className="flex gap-1 mt-2">
                {['25', '50', '75', '100'].map(pct => (
                  <button
                    key={pct}
                    onClick={() => {
                      const pctNum = Number(pct);
                      const bal = BigInt(tokenBBalance);
                      const amt = (bal * BigInt(pctNum)) / 100n;
                      const amtStr = formatUnits(amt.toString(), pool.tokenB.decimals);
                      setAmountB(amtStr);
                      setUserEditedB(true);
                    }}
                    className="flex-1 py-1.5 text-xs font-semibold bg-[var(--app-panel-soft)] rounded-lg hover:bg-[var(--app-hover)] transition-colors"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-[var(--app-muted)] font-medium mb-2 block">Lock Duration</label>
              <div className="flex flex-wrap gap-2">
                {['unlocked', '30d', '6m', '1y', 'custom'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setLockOption(opt as any); setCustomLockDays(''); }}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${lockOption === opt ? 'bg-[var(--app-blue)] text-white' : 'bg-[var(--app-panel-soft)] text-[var(--app-muted)] hover:bg-[var(--app-hover)]'}`}
                  >
                    {opt === 'unlocked' ? 'Unlocked' : opt === '30d' ? '30 Days' : opt === '6m' ? '6 Months' : opt === '1y' ? '1 Year' : 'Custom'}
                  </button>
                ))}
              </div>
              {lockOption === 'custom' && (
                <input
                  type="number"
                  value={customLockDays}
                  onChange={e => setCustomLockDays(sanitizeNumericInput(e.target.value))}
                  placeholder="Days"
                  className="mt-2 w-full bg-[var(--app-input)] border border-[var(--app-border)] text-[var(--app-text)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)]"
                />
              )}
            </div>

            <button
              onClick={handleAddLiquidity}
              disabled={!amountA || !amountB || addStep.type === 'granting_a' || addStep.type === 'granting_b' || addStep.type === 'adding_liquidity'}
              className="w-full py-3 bg-[var(--app-blue)] hover:bg-[var(--app-blue-2)] text-white font-bold rounded-xl transition-all disabled:opacity-50"
            >
              {addStep.type === 'granting_a' ? 'Approving A...' : addStep.type === 'granting_b' ? 'Approving B...' : addStep.type === 'adding_liquidity' ? 'Adding...' : 'Add Liquidity'}
            </button>

            {addStep.type === 'error' && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3">
                {addStep.message}
              </div>
            )}
          </div>
        )}

        {tab === 'remove' && (
          <div className="space-y-4">
            <div className="bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl p-3 text-xs text-[var(--app-muted)] leading-relaxed">
              <span className="font-medium text-[var(--app-text)]">ℹ How removal works:</span> Each
              <span className="font-mono"> remove_liquidity </span> call closes <span className="font-medium">one</span> full position.
              For partial removal, add liquidity as multiple positions and remove one. Positions that are still locked cannot be removed.
            </div>

            {positions.length > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--app-muted)]">
                  {positions.length} position{positions.length > 1 ? 's' : ''} ({positions.filter(p => p.unlocked).length} unlocked)
                </span>
                <button
                  onClick={handleCloseAllUnlocked}
                  disabled={closingAll || positions.filter(p => p.unlocked).length === 0 || removeStep.type === 'removing'}
                  className="px-3 py-1.5 bg-orange-600/80 hover:bg-orange-600 text-white font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                >
                  {closingAll ? 'Closing…' : 'Close all unlocked'}
                </button>
              </div>
            )}

            <div>
              <label className="text-xs text-[var(--app-muted)] font-medium mb-2 block">Select Position</label>
              {positions.length === 0 ? (
                <div className="text-center py-6 text-sm text-[var(--app-muted)]">No positions found</div>
              ) : (
                <select
                  value={selectedPositionId || ''}
                  onChange={e => setSelectedPositionId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full bg-[var(--app-input)] border border-[var(--app-border)] text-[var(--app-text)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)]"
                >
                  <option value="">Select a position</option>
                  {positions.map(pos => (
                    <option key={pos.id} value={pos.id} disabled={!pos.unlocked}>
                      ID: #{pos.id} — {formatUnits(pos.reserveA || '0', pool.tokenA.decimals)} {pool.tokenA.symbol} + {formatUnits(pos.reserveB || '0', pool.tokenB.decimals)} {pool.tokenB.symbol}{pos.unlocked ? '' : ' (LOCKED)'}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedPosition && (
              <>
                <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--app-muted)]">Token A</span>
                    <span className="font-mono">{formatUnits(selectedPosition.reserveA || '0', pool.tokenA.decimals)} {pool.tokenA.symbol}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--app-muted)]">Token B</span>
                    <span className="font-mono">{formatUnits(selectedPosition.reserveB || '0', pool.tokenB.decimals)} {pool.tokenB.symbol}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--app-muted)]">Status</span>
                    <span className={selectedPosition.unlocked ? 'text-green-400' : 'text-yellow-400'}>
                      {selectedPosition.unlocked ? 'Unlocked' : `Locked (${selectedPosition.lockTime} blocks)`}
                    </span>
                  </div>
                </div>

                <button
                  onClick={handleRemoveLiquidity}
                  disabled={removeStep.type === 'removing' || !selectedPosition.unlocked}
                  className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {removeStep.type === 'removing' ? 'Removing...' : selectedPosition.unlocked ? 'Remove Liquidity' : 'Locked — cannot remove'}
                </button>
              </>
            )}

            {removeStep.type === 'error' && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3">
                {removeStep.message}
              </div>
            )}
          </div>
        )}
      </div>

      {isRewardPool && (
        <div className="page-panel p-5">
          <h3 className="text-sm font-semibold mb-3">Reward Pool</h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-[var(--app-muted)]">Claimable {rewardTokenSymbol}</div>
              <div className="font-mono text-lg font-bold">{formatUnits(claimableReward, rewardTokenDecimals)}</div>
            </div>
            <button
              onClick={handleClaimReward}
              disabled={claimingReward || Number(claimableReward) === 0}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50"
            >
              {claimingReward ? 'Claiming...' : 'Claim'}
            </button>
          </div>
        </div>
      )}

      {showPoolSelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[var(--app-panel)] border border-[var(--app-border)] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-4 border-b border-[var(--app-border-soft)]">
              <div className="flex items-center gap-2">
                <input
                  ref={poolSearchRef}
                  type="text"
                  value={poolQuery}
                  onChange={e => setPoolQuery(e.target.value)}
                  placeholder="Search pools..."
                  className="flex-1 bg-[var(--app-input)] border border-[var(--app-border)] text-[var(--app-text)] rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)]"
                />
                <button
                  onClick={() => setShowPoolSelect(false)}
                  className="px-3 py-2 text-sm text-[var(--app-muted)] hover:text-[var(--app-text)]"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto p-2">
              {pools.filter(p => p.label.toLowerCase().includes(poolQuery.toLowerCase())).map(p => (
                <button
                  key={p.address}
                  onClick={() => {
                    const idx = pools.findIndex(pp => pp.address === p.address);
                    setSelectedPoolIdx(idx);
                    setShowPoolSelect(false);
                    setPoolQuery('');
                  }}
                  className="w-full p-3 text-left hover:bg-[var(--app-hover)] rounded-xl transition-colors"
                >
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-[var(--app-muted)] font-mono">{formatAddress(p.address)}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PoolDetails() {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const { pool, loading, loadPool, rpc, isConnected, walletAddress } = usePoolData(address);
  const { addToast } = useApp();
  const [positions, setPositions] = useState<ExtendedLpPosition[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [removeStep, setRemoveStep] = useState<RemoveStep>({ type: 'idle' });
  const [showConfirm, setShowConfirm] = useState(false);
  const { removePool } = usePoolRemoval(addToast, () => {
    navigate('/pool/my-pools');
  });

  const handleRemove = async (confirmTextParam: string) => {
    if (!pool) return { type: 'error' as const, message: 'No pool selected' };
    const result = await removePool(pool.address, confirmTextParam);
    setRemoveStep(result);
    if (result.type === 'done') {
      setShowConfirm(false);
    }
    return result;
  };

  const handleRemovePosition = async (positionId: number) => {
    try {
      const hash = await walletService.callContract({
        contract: CONTRACTS.router,
        method: 'remove_liquidity',
        params: [positionId],
        rpc,
      });
      await rpc.waitForReceipt(hash);
      addToast('success', `Position #${positionId} removed successfully`);
      loadPool(address!);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remove failed';
      addToast('error', `Remove failed: ${msg}`);
    }
  };

  useEffect(() => {
    if (!address || !isConnected || !walletAddress) return;
    let cancelled = false;
    (async () => {
      setLoadingPositions(true);
      try {
        const allPositions = await rpc.getPositions(address, walletAddress).catch(() => []);
        const userPositions = allPositions.filter(
          (pos: any) => pos.pool === address && pos.owner.toLowerCase() === walletAddress.toLowerCase()
        );
        if (!cancelled) setPositions(userPositions);
      } catch (err) {
        console.error('Failed to load positions:', err);
      } finally {
        if (!cancelled) setLoadingPositions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address, isConnected, walletAddress, rpc]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl">❌</div>
        <h2 className="text-xl font-bold text-[var(--app-text)] mt-4">Pool Not Found</h2>
        <p className="text-sm text-[var(--app-muted)] mt-2">The requested pool could not be found.</p>
        <Link to="/pool/my-pools" className="inline-block mt-4 px-4 py-2 bg-[var(--app-blue)] hover:bg-[var(--app-blue-hover)] text-white font-semibold rounded-xl transition-all">
          Back to My Pools
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl w-full space-y-6 pb-16 pt-2 px-2">
      <div className="flex items-center gap-4">
        <Link to="/pool/my-pools" className="flex items-center gap-2 px-3 py-2 bg-[var(--app-panel)] hover:bg-[var(--app-panel-soft)] text-[var(--app-text)] font-semibold rounded-xl transition-all">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to My Pools
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs font-mono text-indigo-400 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            Pool Details
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {pool.symbolA} / {pool.symbolB}
          </h1>
        </div>
      </div>

      <div className="bg-[var(--app-panel)] rounded-2xl border border-[var(--app-border)] p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 border-2 border-[var(--app-panel)] flex items-center justify-center text-sm font-bold text-white">
                {pool.symbolA.slice(0, 1)}
              </div>
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 border-2 border-[var(--app-panel)] flex items-center justify-center text-sm font-bold text-white">
                {pool.symbolB.slice(0, 1)}
              </div>
            </div>
            <div>
              <div className="font-bold text-[var(--app-text)] text-lg">{pool.symbolA} / {pool.symbolB}</div>
              <div className="text-xs text-[var(--app-muted)] font-mono">{formatAddress(pool.address)}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${pool.active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {pool.active ? 'Active' : 'Paused'}
            </span>
            <span className="text-xs text-[var(--app-muted)] bg-[var(--app-panel-soft)] px-3 py-1 rounded-lg">
              Fee: {((pool.feeNum / pool.feeDenom) * 100).toFixed(2)}%
            </span>
            <span className="text-xs text-[var(--app-muted)] bg-[var(--app-panel-soft)] px-3 py-1 rounded-lg">
              Owner: {formatAddress(pool.owner)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <ReserveIndicator value={pool.reserveA} label="Reserve A" />
          <ReserveIndicator value={pool.reserveB} label="Reserve B" />
          <ReserveIndicator value={pool.totalLp} label="Total LP" />
        </div>

        <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 space-y-2">
          <div className="text-xs text-[var(--app-muted)] uppercase tracking-wider mb-2">Token Contracts</div>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-[var(--app-muted)]">Token A:</span>
              <span className="text-[var(--app-text)] break-all">{pool.tokenA}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--app-muted)]">Token B:</span>
              <span className="text-[var(--app-text)] break-all">{pool.tokenB}</span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--app-border-soft)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[var(--app-text)]">Pool Removal</h3>
              <p className="text-xs text-[var(--app-muted)] mt-1">
                {!isPoolRemovable(pool) && 'Pool can only be removed after all liquidity positions have been withdrawn (zero reserves & zero LP). '}
                {isPoolRemovable(pool) && 'Pool is empty and safe to remove.'}
              </p>
            </div>
            <button
              disabled={!isPoolRemovable(pool)}
              onClick={() => { setShowConfirm(true); setRemoveStep({ type: 'idle' }); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${isPoolRemovable(pool)
                ? 'bg-red-600/90 hover:bg-red-600 text-white cursor-pointer shadow-lg shadow-red-900/30'
                : 'bg-[var(--app-panel-soft)] text-[var(--app-muted)] cursor-not-allowed opacity-50'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Remove Pool
            </button>
          </div>

          {removeStep.type === 'error' && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3">
              {removeStep.message}
            </div>
          )}
        </div>
      </div>

      <div className="bg-[var(--app-panel)] rounded-2xl border border-[var(--app-border)] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[var(--app-text)]">Your Liquidity Positions</h3>
            <p className="text-xs text-[var(--app-muted)] mt-1">
              {positions.length === 0 && 'You have no liquidity positions in this pool.'}
              {positions.length === 1 && 'You have 1 active liquidity position.'}
              {positions.length > 1 && `You have ${positions.length} active liquidity positions.`}
            </p>
          </div>
        </div>

        {loadingPositions && (
          <div className="flex justify-center py-8">
            <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          </div>
        )}

        {!loadingPositions && positions.length === 0 && (
          <div className="text-center py-8 text-[var(--app-muted)]">
            <div className="text-3xl mb-2">💰</div>
            <p className="text-sm">No liquidity positions found.</p>
          </div>
        )}

        {positions.map((position) => (
          <div key={position.id} className="bg-[var(--app-panel)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white">
                  💰
                </div>
                <div>
                  <div className="font-bold text-[var(--app-text)]">LP Position</div>
                  <div className="text-xs text-[var(--app-muted)] font-mono">ID: #{position.id}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-[var(--app-muted)]">Value</div>
                <div className="font-mono text-sm font-bold text-[var(--app-text)]">
                  {(Number(position.reserveA || '0') + Number(position.reserveB || '0')).toFixed(2)} tokens
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ReserveIndicator value={position.reserveA || '0'} label="Token A" />
              <ReserveIndicator value={position.reserveB || '0'} label="Token B" />
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-[var(--app-muted)]">
                {position.unlocked ? (
                  <span className="text-green-400">Unlocked</span>
                ) : (
                  <span className="text-yellow-400">Locked (in {position.lockTime} blocks)</span>
                )}
              </div>
              <button
                onClick={() => handleRemovePosition(position.id)}
                className="flex items-center gap-2 px-3 py-1.5 bg-red-600/90 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      {showConfirm && pool && (
        <RemovePoolModal
          pool={pool}
          isOpen={showConfirm}
          onClose={() => setShowConfirm(false)}
          onConfirm={handleRemove}
          removeStep={removeStep}
        />
      )}
    </div>
  );
}

function PoolPage() {
  const location = useLocation();
  const navigate = useNavigate();

  const currentTab = useMemo(() => {
    if (location.pathname === '/pool' || location.pathname === '/pool/') return 'browse';
    if (location.pathname.startsWith('/pool/my-pools')) return 'my-pools';
    if (location.pathname.startsWith('/pool/liquidity')) return 'liquidity';
    if (location.pathname.match(/^\/pool\/[^/]+$/)) return 'details';
    return 'browse';
  }, [location.pathname]);

  const handlePoolSelect = (address: string) => {
    navigate(`/pool/liquidity?pool=${address}`);
  };

  const handleMyPoolSelect = (address: string) => {
    navigate(`/pool/${address}`);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'browse', label: 'Browse' },
    { id: 'my-pools', label: 'My Pools' },
    { id: 'liquidity', label: 'Liquidity' },
  ];

  return (
    <div className="min-h-screen">
      {currentTab !== 'details' && (
        <div className="page-surface mx-auto w-full max-w-5xl pt-1 sm:pt-3">
          <div className="sticky top-[68px] z-20 flex gap-2 mb-5 p-1 bg-[var(--app-panel-soft)]/95 backdrop-blur-xl rounded-xl shadow-lg shadow-black/10">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => navigate(`/pool/${tab.id}`)}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${currentTab === tab.id
                  ? 'bg-[var(--app-blue)] text-white shadow-md'
                  : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <Routes>
        <Route index element={<BrowsePools onPoolSelect={handlePoolSelect} />} />
        <Route path="browse" element={<BrowsePools onPoolSelect={handlePoolSelect} />} />
        <Route path="my-pools" element={<MyPoolsList onPoolSelect={handleMyPoolSelect} />} />
        <Route path="liquidity" element={<LiquidityTab />} />
        <Route path=":address" element={<PoolDetails />} />
      </Routes>
    </div>
  );
}

export default PoolPage;
