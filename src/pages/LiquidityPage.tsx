import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { CONTRACTS } from '../types';
import { formatUnits, parseUnits } from '../services/swapService';
import type { LpPosition } from '../services/octraRpc';

interface DynamicPool {
  address: string;
  tokenA: { address: string; symbol: string; name: string; decimals: number };
  tokenB: { address: string; symbol: string; name: string; decimals: number };
  label: string;
}

const UNKNOWN_TOKEN = { address: '', symbol: '???', name: 'Unknown', decimals: 6 };

type Tab = 'add' | 'remove';

function LiquidityPage() {
  const { rpc, isConnected, walletAddress, addToast, updateToast } = useApp();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('add');
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
  const [positions, setPositions] = useState<LpPosition[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const [tokenABalance, setTokenABalance] = useState('0');
  const [loading, setLoading] = useState(false);
  const [currentEpoch, setCurrentEpoch] = useState<number>(0);
  const [rewardsPerEpoch, setRewardsPerEpoch] = useState<number>(0);
  const [totalLockedLp, setTotalLockedLp] = useState<string>('0');
  const [lockOption, setLockOption] = useState<'unlocked' | '30d' | '6m' | '1y' | 'custom'>('unlocked');
  const [customLockDays, setCustomLockDays] = useState<string>('');

  const pool = pools[selectedPoolIdx];
  const mountedRef = useRef(true);
  const poolSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showPoolSelect) {
      setTimeout(() => poolSearchRef.current?.focus(), 100);
    } else {
      setPoolQuery('');
    }
  }, [showPoolSelect]);

  const filteredPools = useMemo(() => {
    if (!poolQuery) return pools;
    const q = poolQuery.toLowerCase();
    return pools.filter(p =>
      p.label.toLowerCase().includes(q) ||
      p.address.toLowerCase().includes(q)
    );
  }, [pools, poolQuery]);

  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      setPoolLoading(true);
      try {
        const poolAddrs = await rpc.getAllPools(CONTRACTS.factory);
        // Include config pool if not already in factory list
        if (CONTRACTS.pool && !poolAddrs.includes(CONTRACTS.pool)) {
          poolAddrs.push(CONTRACTS.pool);
        }
        const poolInfos: DynamicPool[] = [];
        for (const addr of poolAddrs) {
          try {
            const info = await rpc.getPoolInfo(addr);
            if (!info.tokenA || !info.tokenB) continue;
            const metaA = await rpc.getTokenMeta(info.tokenA);
            const metaB = await rpc.getTokenMeta(info.tokenB);
            if (!metaA.symbol || metaA.symbol === '???') continue;
            if (!metaB.symbol || metaB.symbol === '???') continue;
            poolInfos.push({
              address: addr,
              tokenA: { address: info.tokenA, ...metaA },
              tokenB: { address: info.tokenB, ...metaB },
              label: `${metaA.symbol} / ${metaB.symbol}`,
            });
          } catch {
            // skip this pool
          }
        }
        if (mountedRef.current) {
          setPools(poolInfos);
          const preselected = searchParams.get('pool');
          if (preselected) {
            const idx = poolInfos.findIndex(p => p.address === preselected);
            if (idx !== -1) setSelectedPoolIdx(idx);
          }
        }
      } catch {
        if (mountedRef.current) setPools([]);
      } finally {
        if (mountedRef.current) {
          setPoolLoading(false);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, [rpc, searchParams]);

  const loadPoolInfo = useCallback(async () => {
    if (!pool) return;
    try {
      const reserves = await rpc.getReserves(pool.address);
      setReserveA(reserves.reserveA);
      setReserveB(reserves.reserveB);
    } catch { /* noop */ }
    if (isConnected && walletAddress) {
      try {
        const lp = await rpc.getLpBalance(pool.address, walletAddress);
        setLpBalance(lp);
        const total = await rpc.getTotalLpSupply(pool.address);
        setTotalLP(total);
        const userPositions = await rpc.getPositions(pool.address, walletAddress);
        setPositions(userPositions);
        if (userPositions.length > 0 && selectedPositionId === null) {
          setSelectedPositionId(userPositions[0].id);
        }
        const bal = await rpc.getTokenBalance(pool.tokenA.address || CONTRACTS.woct, walletAddress);
        setTokenABalance(bal);
      } catch { /* noop */ }
      try {
        const currentEpochRes = await rpc.call<{ epoch_id: number }>('epoch_current');
        setCurrentEpoch(currentEpochRes?.epoch_id || 0);
      } catch (err) {
        console.warn('Failed to fetch epoch info:', err);
      }
      try {
        const oesAddr = CONTRACTS.oes || pool.tokenB.address;
        const rewardsInfo = await rpc.getOesRewardsInfo(oesAddr);
        if (mountedRef.current) setRewardsPerEpoch(rewardsInfo.rewardsPerEpoch);
      } catch { /* noop */ }
      try {
        const locked = await rpc.getTotalLockedLp(pool.address);
        if (mountedRef.current) setTotalLockedLp(locked);
      } catch { /* noop */ }
    }
  }, [rpc, isConnected, walletAddress, pool, selectedPositionId]);

  useEffect(() => { loadPoolInfo(); const i = setInterval(loadPoolInfo, 10000); return () => clearInterval(i); }, [loadPoolInfo]);

  const validTokenA = pool?.tokenA || UNKNOWN_TOKEN;
  const validTokenB = pool?.tokenB || UNKNOWN_TOKEN;

  const isEmptyPool = reserveA === '0' && reserveB === '0';

  useEffect(() => {
    if (isEmptyPool) return;
    if (amountA && amountA !== '0' && reserveA !== '0' && reserveB !== '0') {
      const expectedB = formatUnits(
        ((BigInt(parseUnits(amountA, validTokenA.decimals)) * BigInt(reserveB)) / BigInt(reserveA)).toString(),
        validTokenB.decimals
      );
      setAmountB(expectedB);
    }
  }, [amountA, reserveA, reserveB, isEmptyPool, validTokenA.decimals, validTokenB.decimals]);

  const poolShare = totalLP !== '0' && lpBalance !== '0'
    ? Number(BigInt(lpBalance) * 10000n / BigInt(totalLP)) / 100
    : 0;

  const selectedPosition = positions.find(p => p.id === selectedPositionId);
  const selectedPositionLp = selectedPosition?.liquidity || lpBalance;

  const removeEstimates = {
    a: totalLP !== '0' && selectedPositionLp !== '0'
      ? formatUnits(((BigInt(reserveA) * BigInt(selectedPositionLp)) / BigInt(totalLP)).toString(), validTokenA.decimals)
      : '0',
    b: totalLP !== '0' && selectedPositionLp !== '0'
      ? formatUnits(((BigInt(reserveB) * BigInt(selectedPositionLp)) / BigInt(totalLP)).toString(), validTokenB.decimals)
      : '0',
  };

  const handleAddLiquidity = async () => {
    if (!pool) return;
    // [V7-SECURITY-FIX] Validate amounts before submission
    const trimmedA = amountA.trim();
    const trimmedB = amountB.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmedA) || Number(trimmedA) <= 0) {
      addToast('error', 'Enter a valid amount for ' + validTokenA.symbol);
      return;
    }
    if (isEmptyPool && (!/^\d+(\.\d+)?$/.test(trimmedB) || Number(trimmedB) <= 0)) {
      addToast('error', 'Enter a valid amount for ' + validTokenB.symbol);
      return;
    }
    setLoading(true);
    const toastId = addToast('pending', 'Add Liquidity in progress...');
    try {
      const rawA = parseUnits(amountA, validTokenA.decimals);
      const rawB = parseUnits(amountB, validTokenB.decimals);

      // Calculate lock duration in epochs (1 epoch = 1 minute)
      let lockDuration = 0;
      if (lockOption === '30d') {
        lockDuration = 30 * 24 * 60; // 43200 epochs
      } else if (lockOption === '6m') {
        lockDuration = 182 * 24 * 60; // 262080 epochs (6 months)
      } else if (lockOption === '1y') {
        lockDuration = 365 * 24 * 60; // 525600 epochs (1 year)
      } else if (lockOption === 'custom') {
        // [V6-SECURITY-FIX MED-14] Validate custom lock: min 1 day, no negatives
        const days = parseInt(customLockDays, 10) || 0;
        if (days < 1) {
          throw new Error('Custom lock duration must be at least 1 day');
        }
        if (days > 365) {
          throw new Error('Maximum lock duration is 365 days');
        }
        lockDuration = days * 24 * 60;
      }

      // [V6-SECURITY-FIX HIGH-8] Add 5-minute deadline
      const deadline = Math.floor(Date.now() / 1000 + 300);

      // [V6-SECURITY-FIX HIGH-8] Calculate proper min_lp with slippage (10% tolerance)
      // First deposit: accept any LP > 0. Subsequent: estimate from reserves.
      let minLp = '1';
      if (totalLP !== '0' && reserveA !== '0') {
        const lpEstimate = (BigInt(rawA) * BigInt(totalLP)) / BigInt(reserveA);
        const slippageBps = 1000n; // 10%
        const minLpRaw = lpEstimate - (lpEstimate * slippageBps / 10000n);
        minLp = minLpRaw > 0n ? minLpRaw.toString() : '1';
      }

      updateToast(toastId, 'pending', `Approving ${validTokenA.symbol} grant in wallet...`);
      const grantAHash = await walletService.callContract({
        contract: pool.tokenA.address,
        method: 'grant',
        params: [pool.address, rawA],
      });
      updateToast(toastId, 'pending', `Waiting for ${validTokenA.symbol} grant confirmation...`, grantAHash);
      await rpc.waitForReceipt(grantAHash);

      updateToast(toastId, 'pending', `Approving ${validTokenB.symbol} grant in wallet...`);
      const grantBHash = await walletService.callContract({
        contract: pool.tokenB.address,
        method: 'grant',
        params: [pool.address, rawB],
      });
      updateToast(toastId, 'pending', `Waiting for ${validTokenB.symbol} grant confirmation...`, grantBHash);
      await rpc.waitForReceipt(grantBHash);

      updateToast(toastId, 'pending', 'Approving add liquidity in wallet...');
      const addHash = await walletService.callContract({
        contract: pool.address,
        method: 'add_liquidity',
        params: [rawA, rawB, minLp, String(deadline), String(lockDuration)],
      });
      updateToast(toastId, 'pending', 'Waiting for add liquidity confirmation...', addHash);
      await rpc.waitForReceipt(addHash);

      updateToast(toastId, 'success', `Add ${amountA} ${validTokenA.symbol} / ${amountB} ${validTokenB.symbol} successful!`, addHash);
      setAmountA('');
      loadPoolInfo();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'An error occurred';
      updateToast(toastId, 'error', `Add Liquidity failed: ${errMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!pool || selectedPositionId === null) return;
    const selectedPosition = positions.find(p => p.id === selectedPositionId);
    if (!selectedPosition) return;
    if (selectedPosition.unlockTime > currentEpoch) {
      const remainingMinutes = selectedPosition.unlockTime - currentEpoch;
      const days = Math.floor(remainingMinutes / (24 * 60));
      const hours = Math.floor((remainingMinutes % (24 * 60)) / 60);
      const mins = remainingMinutes % 60;
      let timeStr = '';
      if (days > 0) timeStr += `${days}d `;
      if (hours > 0) timeStr += `${hours}h `;
      timeStr += `${mins}m`;
      addToast('error', `Cannot remove position #${selectedPosition.id}: locked for another ${timeStr.trim()}.`);
      return;
    }

    setLoading(true);
    const toastId = addToast('pending', 'Remove Liquidity in progress...');
    try {
      // [V6-SECURITY-FIX HIGH-8] Calculate proper min amounts with 10% slippage and deadline
      const deadline = Math.floor(Date.now() / 1000 + 300);
      const minA = removeEstimates.a !== '0'
        ? (BigInt(parseUnits(removeEstimates.a, validTokenA.decimals)) * 9000n / 10000n).toString()
        : '1';
      const minB = removeEstimates.b !== '0'
        ? (BigInt(parseUnits(removeEstimates.b, validTokenB.decimals)) * 9000n / 10000n).toString()
        : '1';

      updateToast(toastId, 'pending', 'Approving remove liquidity in wallet...');
      const removeHash = await walletService.callContract({
        contract: pool.address,
        method: 'remove_liquidity',
        params: [selectedPositionId, minA, minB, String(deadline)],
      });
      updateToast(toastId, 'pending', 'Waiting for remove liquidity confirmation...', removeHash);
      await rpc.waitForReceipt(removeHash);

      updateToast(toastId, 'success', `Remove position #${selectedPositionId} successful!`, removeHash);
      setSelectedPositionId(null);
      loadPoolInfo();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'An error occurred';
      updateToast(toastId, 'error', `Remove Liquidity failed: ${errMsg}`);
    } finally {
      setLoading(false);
    }
  };

  if (poolLoading) {
    return (
      <div className="max-w-lg mx-auto pt-4">
        <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6">
          <div className="h-6 w-40 bg-[var(--app-panel-soft)] rounded animate-pulse mb-4" />
          <div className="h-20 bg-[var(--app-panel-soft)] rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <><div className="max-w-lg mx-auto pt-4 space-y-4">
      <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] overflow-hidden">
        <div className="flex border-b border-[var(--app-border)]">
          <button
            onClick={() => setTab('add')}
            className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${tab === 'add' ? 'bg-[var(--app-blue)]/10 text-[var(--app-blue-3)] border-b-2 border-[var(--app-blue)]' : 'text-[var(--app-muted)] hover:text-[var(--app-text)]'}`}
          >
            Add Liquidity
          </button>
          <button
            onClick={() => setTab('remove')}
            className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${tab === 'remove' ? 'bg-[var(--app-blue)]/10 text-[var(--app-blue-3)] border-b-2 border-[var(--app-blue)]' : 'text-[var(--app-muted)] hover:text-[var(--app-text)]'}`}
          >
            Remove Liquidity
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="relative">
            <button
              onClick={() => setShowPoolSelect(!showPoolSelect)}
              className="flex items-center gap-2 bg-[var(--app-panel-soft)] rounded-xl px-4 py-2.5 border border-[var(--app-border)] hover:border-[#3B82F6] transition-colors w-full text-left"
            >
              <div className="flex -space-x-2">
                <div className="w-7 h-7 rounded-full bg-[var(--app-blue)] flex items-center justify-center text-xs font-bold border-2 border-[var(--app-bg)]">
                  {validTokenA.symbol[0] || '?'}
                </div>
                <div className="w-7 h-7 rounded-full bg-[var(--app-blue-2)] flex items-center justify-center text-xs font-bold border-2 border-[var(--app-bg)]">
                  {validTokenB.symbol[0] || '?'}
                </div>
              </div>
              <span className="font-medium text-sm flex-1">{pool?.label || 'Select Pool'}</span>
              <svg className="w-4 h-4 text-[var(--app-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showPoolSelect && (
              <div className="fixed inset-0 bg-black/75 backdrop-blur-xl z-50 flex items-center justify-center p-4" onClick={() => { setShowPoolSelect(false); setPoolQuery(''); }}>
                <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] w-full max-w-sm shadow-2xl flex flex-col max-h-[70vh]" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--app-border)]">
                    <h3 className="text-sm font-semibold">Select Pool</h3>
                    <button onClick={() => { setShowPoolSelect(false); setPoolQuery(''); }} className="text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="px-5 pt-3 pb-1">
                    <div className="relative">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--app-muted-2)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        ref={poolSearchRef}
                        type="text"
                        value={poolQuery}
                        onChange={e => setPoolQuery(e.target.value)}
                        placeholder="Search pool..."
                        className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl pl-9 pr-3 py-2 text-sm outline-none placeholder-[var(--app-muted-2)] focus:border-[var(--app-blue)] transition-colors"
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto flex-1 p-2 pb-3 space-y-0.5 min-h-0">
                    {filteredPools.length === 0 ? (
                      <div className="text-center py-8 text-sm text-[var(--app-muted)]">
                        {poolQuery ? 'No pools found' : 'No pools available'}
                      </div>
                    ) : (
                      filteredPools.map((p) => {
                        const origIdx = pools.indexOf(p);
                        return (
                          <button
                            key={p.address}
                            onClick={() => { setSelectedPoolIdx(origIdx); setShowPoolSelect(false); setPoolQuery(''); }}
                            className={`w-full px-4 py-2.5 text-left text-sm rounded-xl transition-colors flex items-center gap-2 ${origIdx === selectedPoolIdx ? 'bg-[var(--app-blue)]/10 text-[var(--app-blue-3)]' : 'hover:bg-[var(--app-hover)]'}`}
                          >
                            <div className="flex -space-x-2">
                              <div className="w-6 h-6 rounded-full bg-[var(--app-blue)] flex items-center justify-center text-xs font-bold border-2 border-[var(--app-bg)]">{p.tokenA.symbol[0] || '?'}</div>
                              <div className="w-6 h-6 rounded-full bg-[var(--app-blue-2)] flex items-center justify-center text-xs font-bold border-2 border-[var(--app-bg)]">{p.tokenB.symbol[0] || '?'}</div>
                            </div>
                            <span className="text-[var(--app-muted)]">{p.label}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {tab === 'add' ? (
          <div className="p-6 space-y-3">
            <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-[var(--app-muted)]">{validTokenA.symbol}</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={amountA}
                  onChange={e => setAmountA(e.target.value)}
                  placeholder="0.0"
                  className="flex-1 bg-transparent text-2xl font-mono outline-none placeholder-[var(--app-muted-2)]"
                />
                <span className="font-medium px-3 py-1.5 bg-[var(--app-hover)] rounded-lg">{validTokenA.symbol}</span>
              </div>
              <div className="flex gap-2 mt-2">
                {[10, 25, 50, 100].map(pct => (
                  <button
                    key={pct}
                    onClick={() => {
                      if (tokenABalance && tokenABalance !== '0') {
                        const val = formatUnits(
                          (BigInt(tokenABalance) * BigInt(pct) / 100n).toString(),
                          validTokenA.decimals
                        );
                        setAmountA(val);
                      }
                    }}
                    className="flex-1 py-1 text-xs rounded-lg font-medium bg-[var(--app-hover)] text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-center">
              <svg className="w-5 h-5 text-[var(--app-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
            <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-[var(--app-muted)]">{validTokenB.symbol}</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={amountB}
                  onChange={e => isEmptyPool ? setAmountB(e.target.value) : undefined}
                  readOnly={!isEmptyPool}
                  placeholder="0.0"
                  className="flex-1 bg-transparent text-2xl font-mono outline-none placeholder-[var(--app-muted-2)]"
                />
                <span className="font-medium px-3 py-1.5 bg-[var(--app-hover)] rounded-lg">{validTokenB.symbol}</span>
              </div>
            </div>
            <div className="bg-[var(--app-panel-soft)] rounded-xl p-3 space-y-1 text-xs">
              <div className="flex justify-between text-[var(--app-muted)]">
                <span>Price</span>
                <span>1 {validTokenA.symbol} = {reserveB !== '0' ? (Number(formatUnits(reserveB, validTokenB.decimals)) / Number(formatUnits(reserveA, validTokenA.decimals))).toFixed(6) : '0'} {validTokenB.symbol}</span>
              </div>
               <div className="flex justify-between text-[var(--app-muted)]">
                 <span>Share of Pool</span>
                 <span>
                   {reserveA !== '0' && amountA && amountA !== '0'
                     ? `${((BigInt(parseUnits(amountA, validTokenA.decimals)) * 100n) / BigInt(reserveA)).toString()}%`
                     : '0%'}
                 </span>
               </div>
            </div>
            {/* Liquidity Lock Options */}
            <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
              <span className="text-xs font-semibold text-[var(--app-muted)] block">Liquidity Lock Duration</span>
              
              <div className="grid grid-cols-5 bg-[var(--app-panel)] rounded-xl p-1 border border-[var(--app-border)]">
                {[
                  { value: 'unlocked', label: 'Unlocked', short: 'Free', icon: '🔓' },
                  { value: '30d', label: '30 Days', short: '30D', icon: '🔒' },
                  { value: '6m', label: '6 Months', short: '6M', icon: '🔒' },
                  { value: '1y', label: '1 Year', short: '1Y', icon: '🔒' },
                  { value: 'custom', label: 'Custom', short: 'Custom', icon: '⚙️' }
                ].map(opt => {
                  const isSelected = lockOption === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setLockOption(opt.value as 'unlocked' | '30d' | '6m' | '1y' | 'custom')}
                      className={`flex flex-col sm:flex-row items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                        isSelected
                          ? 'bg-[var(--app-blue)] text-white shadow-sm shadow-[var(--app-shadow)] font-semibold'
                          : 'text-[var(--app-muted)] hover:text-[var(--app-text)] hover:bg-[var(--app-hover)]'
                      }`}
                    >
                      <span className="text-xs">{opt.icon}</span>
                      <span className="hidden sm:inline">{opt.label}</span>
                      <span className="sm:hidden">{opt.short}</span>
                    </button>
                  );
                })}
              </div>

              {lockOption === 'custom' && (
                <div className="flex items-center gap-2 bg-[var(--app-panel)] border border-[var(--app-border)] rounded-lg px-3 py-1.5">
                  <span className="text-xs text-[var(--app-muted)]">Lock Days:</span>
                  <input
                    type="number"
                    min="1"
                    placeholder="Enter days"
                    value={customLockDays}
                    onChange={e => setCustomLockDays(e.target.value)}
                    className="flex-1 bg-transparent border-none outline-none text-xs font-mono text-[var(--app-text)] text-right"
                  />
                  <span className="text-xs text-[var(--app-muted)]">Days</span>
                </div>
              )}
            </div>

            <button
              onClick={handleAddLiquidity}
              disabled={!amountA || !/^\d+(\.\d+)?$/.test(amountA.trim()) || Number(amountA) <= 0 || (isEmptyPool && (!amountB || !/^\d+(\.\d+)?$/.test(amountB.trim()) || Number(amountB) <= 0)) || !isConnected || loading}
              className="w-full py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors"
            >
              {!isConnected ? 'Connect Wallet' : loading ? 'Processing...' : isEmptyPool ? 'Add Initial Liquidity' : 'Add Liquidity'}
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-3">
            <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
              <div className="text-xs text-[var(--app-muted)] mb-1">Your LP Balance</div>
              <div className="text-2xl font-mono">{formatUnits(lpBalance, 12)} LP</div>
              <div className="text-xs text-[var(--app-muted)] mt-2">
                {positions.length} position{positions.length === 1 ? '' : 's'}
              </div>
            </div>

            {positions.length === 0 ? (
              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] text-center text-sm text-[var(--app-muted)]">
                No LP positions in this pool
              </div>
            ) : (
              <div className="space-y-2">
                {positions.map(pos => {
                  const isLocked = pos.unlockTime > currentEpoch;
                  const remaining = isLocked ? pos.unlockTime - currentEpoch : 0;
                  const days = Math.floor(remaining / (24 * 60));
                  const hours = Math.floor((remaining % (24 * 60)) / 60);
                  const mins = remaining % 60;
                  return (
                    <button
                      key={pos.id}
                      onClick={() => setSelectedPositionId(pos.id)}
                      className={`w-full p-4 rounded-xl border text-left transition-colors ${
                        selectedPositionId === pos.id
                          ? 'bg-[var(--app-blue)]/10 border-[var(--app-blue)]'
                          : 'bg-[var(--app-panel-soft)] border-[var(--app-border)] hover:bg-[var(--app-hover)]'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="text-sm font-semibold">Position #{pos.id}</div>
                          <div className="text-xs text-[var(--app-muted)] mt-1">
                            {formatUnits(pos.liquidity, 12)} LP
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          isLocked ? 'bg-orange-500/10 text-orange-400' : 'bg-green-500/10 text-green-400'
                        }`}>
                          {isLocked ? '🔒 Locked' : '🔓 Unlocked'}
                        </span>
                      </div>
                      {isLocked && (
                        <div className="text-xs text-[var(--app-muted)]">
                          {days > 0 ? `${days}d ` : ''}{hours}h {mins}m remaining
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {selectedPositionId !== null && positions.find(p => p.id === selectedPositionId) && (
              <div className="bg-[var(--app-panel-soft)] rounded-xl p-3 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--app-muted)]">{validTokenA.symbol} to receive</span>
                  <span className="font-mono">{removeEstimates.a}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--app-muted)]">{validTokenB.symbol} to receive</span>
                  <span className="font-mono">{removeEstimates.b}</span>
                </div>
              </div>
            )}

            <button
              onClick={handleRemoveLiquidity}
              disabled={!isConnected || positions.length === 0 || selectedPositionId === null || loading}
              className="w-full py-3 bg-red-500 hover:bg-red-600 disabled:bg-[#2D4A6F] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors"
            >
              {loading ? 'Processing...' : 'Remove Selected Position'}
            </button>
          </div>
        )}
      </div>

        <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-4">
          <h3 className="text-sm font-semibold mb-3">Pool Information</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-[var(--app-muted)]">
              <span>Total Liquidity</span>
              <span className="text-[var(--app-text)] font-mono">{formatUnits(totalLP, 12)} LP</span>
            </div>
            {Number(totalLockedLp) > 0 && (
              <>
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>🔒 Locked LP</span>
                  <span className="text-[var(--app-text)] font-mono">{formatUnits(totalLockedLp, 12)} LP</span>
                </div>
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>🔓 Unlocked LP</span>
                  <span className="text-[var(--app-text)] font-mono">
                    {formatUnits((BigInt(totalLP) - BigInt(totalLockedLp)).toString(), 12)} LP
                  </span>
                </div>
                <div className="w-full bg-[var(--app-panel)] rounded-full h-1.5 overflow-hidden mt-1">
                  <div
                    className="h-full bg-[var(--app-blue)] rounded-full"
                    style={{ width: `${Math.min(100, (Number(totalLockedLp) / Number(totalLP)) * 100)}%` }}
                  />
                </div>
              </>
            )}
            <div className="flex justify-between text-[var(--app-muted)]">
              <span>{validTokenA.symbol} Reserve</span>
              <span className="text-[var(--app-text)] font-mono">{formatUnits(reserveA, validTokenA.decimals)}</span>
            </div>
            <div className="flex justify-between text-[var(--app-muted)]">
              <span>{validTokenB.symbol} Reserve</span>
              <span className="text-[var(--app-text)] font-mono">{formatUnits(reserveB, validTokenB.decimals)}</span>
            </div>
            {rewardsPerEpoch > 0 && (
              <>
                <div className="border-t border-[var(--app-border)] my-2" />
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>OES Rewards Rate</span>
                  <span className="text-[var(--app-text)] font-mono">{formatUnits(String(rewardsPerEpoch), 6)} OES/epoch</span>
                </div>
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>Your Pool Share</span>
                  <span className="text-[var(--app-text)] font-mono">{poolShare.toFixed(4)}%</span>
                </div>
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>Est. Your Rewards</span>
                  <span className="text-[var(--app-text)] font-mono text-[var(--app-success)]">
                    {formatUnits(String(Math.floor(rewardsPerEpoch * poolShare / 100)), 6)} OES/epoch
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
    </div>
    </>
  );
}

export default LiquidityPage;
