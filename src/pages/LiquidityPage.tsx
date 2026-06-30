import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { CONTRACTS } from '../types';
import { formatUnits, parseUnits, sanitizeNumericInput } from '../services/swapService';
import type { LpPosition } from '../services/octraRpc';
import { recordTx } from '../services/txHistory';

interface DynamicPool {
  address: string;
  tokenA: { address: string; symbol: string; name: string; decimals: number };
  tokenB: { address: string; symbol: string; name: string; decimals: number };
  label: string;
}

const UNKNOWN_TOKEN = { address: '', symbol: '???', name: 'Unknown', decimals: 6 };

type Tab = 'add' | 'remove';

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

function LiquidityPage() {
  const { rpc, isConnected, walletAddress, addToast, updateToast, connect, refreshBalance } = useApp();
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
  const [tokenBBalance, setTokenBBalance] = useState('0');
  const [loading, setLoading] = useState(false);
  const [currentEpoch, setCurrentEpoch] = useState<number>(0);
  const [rewardsPerEpoch, setRewardsPerEpoch] = useState<number>(0);
  const [totalLockedLp, setTotalLockedLp] = useState<string>('0');
  const [lockOption, setLockOption] = useState<'unlocked' | '30d' | '6m' | '1y' | 'custom'>('unlocked');
  const [customLockDays, setCustomLockDays] = useState<string>('');
  // [V7-FIX] Track if user has manually edited amountB — don't auto-overwrite
  const [userEditedB, setUserEditedB] = useState(false);
  const [addStep, setAddStep] = useState<AddLiquidityStep>({ type: 'idle' });
  const [removeStep, setRemoveStep] = useState<RemoveLiquidityStep>({ type: 'idle' });

  const pool = pools[selectedPoolIdx];
  const mountedRef = useRef(true);
  const poolSearchRef = useRef<HTMLInputElement>(null);
  // [SECURITY] F-2: Synchronous submit guards to prevent double-click races
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
    let cancelled = false;
    (async () => {
      try {
        const epochRes = await rpc.call<{ epoch_id: number }>('epoch_current');
        if (!cancelled && epochRes?.epoch_id) setCurrentEpoch(epochRes.epoch_id);
      } catch { /* noop */ }
    })();
    return () => { cancelled = true; };
  }, [rpc]);

  const resetAddStep = () => setAddStep({ type: 'idle' });
  const resetRemoveStep = () => setRemoveStep({ type: 'idle' });

  const filteredPools = useMemo(() => {
    if (!poolQuery) return pools;
    const queryLower = poolQuery.toLowerCase();
    return pools.filter(p =>
      p.label.toLowerCase().includes(queryLower) ||
      p.address.toLowerCase().includes(queryLower)
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
            if (idx !== -1) {
              setSelectedPoolIdx(idx);
              // [V7-FIX] Reset position selection when switching pools via searchParams
              // to avoid accidentally removing a position from the wrong pool
              setSelectedPositionId(null);
            }
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
    // [SECURITY] F-5: Capture pool address at the start to detect if user changed
    // pools during the async calls. Avoids state from old pool leaking into new pool.
    const poolAddr = pool.address;
    const tokenAAddr = pool.tokenA.address;
    // [SECURITY] FM-9: Use a local pool snapshot for commit checks
    const targetPoolAddr = poolAddr;
    try {
      const reserves = await rpc.getReserves(poolAddr);
      if (pool?.address !== targetPoolAddr) return;
      setReserveA(reserves.reserveA);
      setReserveB(reserves.reserveB);
    } catch { /* noop */ }
    if (isConnected && walletAddress) {
      try {
        const lp = await rpc.getLpBalance(poolAddr, walletAddress);
        if (pool?.address !== targetPoolAddr) return;
        setLpBalance(lp);
        const total = await rpc.getTotalLpSupply(poolAddr);
        if (pool?.address !== targetPoolAddr) return;
        setTotalLP(total);
        const userPositions = await rpc.getPositions(poolAddr, walletAddress);
        if (pool?.address !== targetPoolAddr) return;
        setPositions(userPositions);
        if (userPositions.length > 0 && selectedPositionId === null) {
          setSelectedPositionId(userPositions[0].id);
        }
        const bal = await rpc.getTokenBalance(tokenAAddr || CONTRACTS.woct, walletAddress);
        if (pool?.address !== targetPoolAddr) return;
        setTokenABalance(bal);
      } catch { /* noop */ }
      try {
        // [SECURITY] F-8: Also fetch tokenB balance for pre-check on add liquidity
        const tokenBAddr = pool?.tokenB?.address;
        if (tokenBAddr) {
          const balB = await rpc.getTokenBalance(tokenBAddr, walletAddress);
          if (pool?.address === targetPoolAddr) setTokenBBalance(balB);
        }
      } catch { /* noop */ }
      try {
        const currentEpochRes = await rpc.call<{ epoch_id: number }>('epoch_current');
        if (pool?.address === targetPoolAddr) setCurrentEpoch(currentEpochRes?.epoch_id || 0);
      } catch {
        console.warn('Failed to fetch epoch info');
      }
      try {
        // [V7-FIX] Only query rewards if CONTRACTS.oes is set. Don't fallback to
        // pool.tokenB which could be WOCT or any other token (no rewards method).
        const oesAddr = CONTRACTS.oes;
        if (oesAddr) {
          const rewardsInfo = await rpc.getOesRewardsInfo(oesAddr);
          if (mountedRef.current && pool?.address === targetPoolAddr) setRewardsPerEpoch(rewardsInfo.rewardsPerEpoch);
        }
      } catch { /* noop */ }
      try {
        const locked = await rpc.getTotalLockedLp(poolAddr);
        if (mountedRef.current && pool?.address === targetPoolAddr) setTotalLockedLp(locked);
      } catch { /* noop */ }
    }
  // [BUG-FIX] Remove selectedPositionId from deps — it caused loadPoolInfo to recreate
  // every time user selects a position, triggering interval reset every 10s.
  // selectedPositionId state is set inside this function (first-time), no circular dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, isConnected, walletAddress, pool]);

  // [V7-FIX] Split into two effects: one for initial load, one for periodic refresh
  // Avoids re-creating interval on every pool/position change
  useEffect(() => { loadPoolInfo(); }, [loadPoolInfo]);
  useEffect(() => {
    const i = setInterval(loadPoolInfo, 10000);
    return () => clearInterval(i);
  }, [loadPoolInfo]);

  const validTokenA = pool?.tokenA || UNKNOWN_TOKEN;
  const validTokenB = pool?.tokenB || UNKNOWN_TOKEN;

  const isEmptyPool = reserveA === '0' && reserveB === '0';

  useEffect(() => {
    // [V7-FIX] Don't auto-overwrite user's manual amountB input
    if (isEmptyPool || userEditedB) return;
    if (amountA && amountA !== '0' && reserveA !== '0' && reserveB !== '0') {
      const expectedB = formatUnits(
        ((BigInt(parseUnits(amountA, validTokenA.decimals)) * BigInt(reserveB)) / BigInt(reserveA)).toString(),
        validTokenB.decimals
      );
      setAmountB(expectedB);
    }
  }, [amountA, reserveA, reserveB, isEmptyPool, validTokenA.decimals, validTokenB.decimals, userEditedB]);

  // [BUG-FIX] Guard against BigInt division by zero: totalLP could be '0' for empty pool
  const poolShare = totalLP !== '0' && lpBalance !== '0' && BigInt(totalLP) > 0n
    ? Number(BigInt(lpBalance) * 10000n / BigInt(totalLP)) / 100
    : 0;

  const selectedPosition = positions.find(p => p.id === selectedPositionId);
  // [V7-FIX] Don't fallback to lpBalance (total of all positions) — that gives
  // wrong "to receive" estimates. Show "—" when position is loading.
  const selectedPositionLp: string | null = selectedPosition ? selectedPosition.liquidity : null;

  const removeEstimates = {
    a: totalLP !== '0' && selectedPositionLp !== null && selectedPositionLp !== '0'
      ? formatUnits(((BigInt(reserveA) * BigInt(selectedPositionLp)) / BigInt(totalLP)).toString(), validTokenA.decimals)
      : '—',
    b: totalLP !== '0' && selectedPositionLp !== null && selectedPositionLp !== '0'
      ? formatUnits(((BigInt(reserveB) * BigInt(selectedPositionLp)) / BigInt(totalLP)).toString(), validTokenB.decimals)
      : '—',
  };

  const ADD_STEPS = [
    { key: 'granting_a', label: `Grant ${validTokenA.symbol} to pool` },
    { key: 'granting_b', label: `Grant ${validTokenB.symbol} to pool` },
    { key: 'adding_liquidity', label: 'Add liquidity' },
  ];

  const handleAddLiquidity = async () => {
    if (!pool) return;
    if (addSubmittingRef.current) return;
    addSubmittingRef.current = true;
    let toastId = '';
    try {
      const trimmedA = amountA.trim();
      const trimmedB = amountB.trim();
      if (!/^\d+(\.\d+)?$/.test(trimmedA) || Number(trimmedA) <= 0) {
        addToast('error', 'Enter a valid amount for ' + validTokenA.symbol);
        return;
      }
      // [BUG-FIX] For initial liquidity, both amounts must be explicitly provided by user
      if (isEmptyPool) {
        if (!/^\d+(\.\d+)?$/.test(trimmedB) || Number(trimmedB) <= 0) {
          addToast('error', 'Enter a valid amount for ' + validTokenB.symbol + ' (initial liquidity requires both amounts)');
          return;
        }
      }
      setLoading(true);
      setAddStep({ type: 'granting_a' });
      toastId = addToast('pending', 'Add Liquidity in progress...');

      const rawA = parseUnits(trimmedA, validTokenA.decimals);
      // [BUG-FIX] For non-empty pool, use auto-computed amountB. Fallback safely.
      const rawB = isEmptyPool
        ? parseUnits(trimmedB, validTokenB.decimals)
        : (amountB && amountB !== '0'
            ? parseUnits(amountB, validTokenB.decimals)
            : parseUnits(trimmedB, validTokenB.decimals));

      if (rawA === '0' || rawA === '') throw new Error(`Amount for ${validTokenA.symbol} is too small`);
      if (rawB === '0' || rawB === '') throw new Error(`Amount for ${validTokenB.symbol} is too small`);

      let lockDuration = 0;
      if (lockOption === '30d') {
        lockDuration = 30 * 24 * 60;
      } else if (lockOption === '6m') {
        lockDuration = 182 * 24 * 60;
      } else if (lockOption === '1y') {
        lockDuration = 365 * 24 * 60;
      } else if (lockOption === 'custom') {
        const days = parseInt(customLockDays, 10) || 0;
        if (days < 1) throw new Error('Custom lock duration must be at least 1 day');
        if (days > 365) throw new Error('Maximum lock duration is 365 days');
        lockDuration = days * 24 * 60;
      }

      const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
      const deadline = (epochInfo?.epoch_id || 0) + 300;

      // [BUG-FIX] For initial liquidity (isEmptyPool), use minLp='1'
      let minLp = '1';
      const GAS_BUFFER = 10000n;
      const checkBalance = (raw: bigint, bal: string, symbol: string, isNative: boolean) => {
        if (bal === '0' || bal === '') return;
        const balBN = BigInt(bal);
        const safeBal = isNative && balBN > GAS_BUFFER ? balBN - GAS_BUFFER : balBN;
        if (raw > safeBal) throw new Error(`Insufficient ${symbol} balance (accounting for gas)`);
      };
      checkBalance(BigInt(rawA), tokenABalance, validTokenA.symbol, validTokenA.address === '');
      checkBalance(BigInt(rawB), tokenBBalance, validTokenB.symbol, validTokenB.address === '');

      if (!isEmptyPool && totalLP !== '0' && reserveA !== '0' && reserveB !== '0') {
        const lpFromA = (BigInt(rawA) * BigInt(totalLP)) / BigInt(reserveA);
        const lpFromB = (BigInt(rawB) * BigInt(totalLP)) / BigInt(reserveB);
        const lpEstimate = lpFromA < lpFromB ? lpFromA : lpFromB;
        const slippageBps = 1000n;
        const minLpRaw = lpEstimate - (lpEstimate * slippageBps / 10000n);
        minLp = minLpRaw > 0n ? minLpRaw.toString() : '1';
      }

      updateToast(toastId, 'pending', `Approving ${validTokenA.symbol} grant in wallet...`);
      const grantAHash = await walletService.callContract({
        contract: pool.tokenA.address,
        method: 'grant',
        params: [pool.address, rawA],
        rpc,
      });
      updateToast(toastId, 'pending', `Waiting for ${validTokenA.symbol} grant confirmation...`, grantAHash);
      await rpc.waitForReceipt(grantAHash);

      setAddStep({ type: 'granting_b' });
      updateToast(toastId, 'pending', `Approving ${validTokenB.symbol} grant in wallet...`);
      const grantBHash = await walletService.callContract({
        contract: pool.tokenB.address,
        method: 'grant',
        params: [pool.address, rawB],
        rpc,
      });
      updateToast(toastId, 'pending', `Waiting for ${validTokenB.symbol} grant confirmation...`, grantBHash);
      await rpc.waitForReceipt(grantBHash);

      setAddStep({ type: 'adding_liquidity' });
      updateToast(toastId, 'pending', 'Approving add liquidity in wallet...');
      const addHash = await walletService.callContract({
        contract: pool.address,
        method: 'add_liquidity',
        params: [rawA, rawB, minLp, String(deadline), String(lockDuration)],
        rpc,
      });
      updateToast(toastId, 'pending', 'Waiting for add liquidity confirmation...', addHash);
      await rpc.waitForReceipt(addHash);

      setAddStep({ type: 'done', txHash: addHash });
      updateToast(toastId, 'success', `Add ${amountA} ${validTokenA.symbol} / ${amountB} ${validTokenB.symbol} successful!`, addHash);
      recordTx({
        hash: addHash,
        type: 'add_liquidity',
        summary: `Add ${amountA} ${validTokenA.symbol} / ${amountB} ${validTokenB.symbol}`,
        timestamp: Date.now(),
        status: 'success',
      });
      // [BUG-FIX] Reset both amounts and userEditedB
      setAmountA('');
      setAmountB('');
      setUserEditedB(false);
      loadPoolInfo();
      refreshBalance();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'An error occurred';
      setAddStep({ type: 'error', message: errMsg });
      if (toastId) updateToast(toastId, 'error', `Add Liquidity failed: ${errMsg}`);
      else addToast('error', `Add Liquidity failed: ${errMsg}`);
    } finally {
      addSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!pool || selectedPositionId === null) return;
    if (removeSubmittingRef.current) return;
    removeSubmittingRef.current = true;
    let toastId = '';
    try {
      const selectedPosition = positions.find(p => p.id === selectedPositionId);
      if (!selectedPosition || selectedPosition.liquidity === '0') {
        addToast('error', `Position #${selectedPositionId} has no liquidity to remove.`);
        return;
      }
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
      setRemoveStep({ type: 'removing' });
      toastId = addToast('pending', 'Remove Liquidity in progress...');
      const [freshReserves, freshTotalLP] = await Promise.all([
        rpc.getReserves(pool.address),
        rpc.getTotalLpSupply(pool.address),
      ]);
      const freshMinA = freshTotalLP !== '0' && selectedPosition.liquidity !== '0'
        ? (BigInt(freshReserves.reserveA) * BigInt(selectedPosition.liquidity) / BigInt(freshTotalLP) * 9000n / 10000n).toString()
        : '1';
      const freshMinB = freshTotalLP !== '0' && selectedPosition.liquidity !== '0'
        ? (BigInt(freshReserves.reserveB) * BigInt(selectedPosition.liquidity) / BigInt(freshTotalLP) * 9000n / 10000n).toString()
        : '1';

      const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
      const deadline = (epochInfo?.epoch_id || 0) + 300;

      updateToast(toastId, 'pending', 'Approving remove liquidity in wallet...');
      const removeHash = await walletService.callContract({
        contract: pool.address,
        method: 'remove_liquidity',
        params: [String(selectedPositionId), freshMinA, freshMinB, String(deadline)],
        rpc,
      });
      updateToast(toastId, 'pending', 'Waiting for remove liquidity confirmation...', removeHash);
      await rpc.waitForReceipt(removeHash);

      setRemoveStep({ type: 'done', txHash: removeHash });
      updateToast(toastId, 'success', `Remove position #${selectedPositionId} successful!`, removeHash);
      recordTx({
        hash: removeHash,
        type: 'remove_liquidity',
        summary: `Remove position #${selectedPositionId}`,
        timestamp: Date.now(),
        status: 'success',
      });
      setSelectedPositionId(null);
      loadPoolInfo();
      refreshBalance();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'An error occurred';
      setRemoveStep({ type: 'error', message: errMsg });
      if (toastId) updateToast(toastId, 'error', `Remove Liquidity failed: ${errMsg}`);
      else addToast('error', `Remove Liquidity failed: ${errMsg}`);
    } finally {
      removeSubmittingRef.current = false;
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
              <div
                className="fixed inset-0 bg-black/75 backdrop-blur-xl z-50 flex items-center justify-center p-4"
                onClick={() => { setShowPoolSelect(false); setPoolQuery(''); }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="select-pool-title"
                tabIndex={-1}
                onKeyDown={e => { if (e.key === 'Escape') { setShowPoolSelect(false); setPoolQuery(''); } }}
              >
                <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] max-w-[52%] w-full flex flex-col max-h-[65%] shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--app-border)]">
                    <h3 id="select-pool-title" className="text-sm font-semibold">Select Pool</h3>
                    <button onClick={() => { setShowPoolSelect(false); setPoolQuery(''); }} className="text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors" aria-label="Close">
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
                            onClick={() => {
                              setSelectedPoolIdx(origIdx);
                              setShowPoolSelect(false);
                              setPoolQuery('');
                              // [V7-FIX] Reset position selection when pool changes
                              setSelectedPositionId(null);
                            }}
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
            {addStep.type !== 'idle' && (
              <div className="bg-[var(--app-panel)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[var(--app-text)]">
                    {addStep.type === 'done' ? 'Liquidity Added' : addStep.type === 'error' ? 'Add Liquidity Failed' : 'Adding Liquidity'}
                  </span>
                  {addStep.type !== 'done' && addStep.type !== 'error' && (
                    <span className="text-xs font-mono text-[var(--app-muted)]">
                      Step {ADD_STEPS.findIndex(s => s.key === addStep.type) + 1}/{ADD_STEPS.length}
                    </span>
                  )}
                </div>
                {addStep.type !== 'done' && addStep.type !== 'error' && (
                  <div className="h-1.5 bg-[var(--app-panel-soft)] rounded-full overflow-hidden border border-[var(--app-border)]">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)]"
                      style={{ width: `${((ADD_STEPS.findIndex(s => s.key === addStep.type) + 1) / ADD_STEPS.length) * 100}%` }}
                    />
                  </div>
                )}
                {addStep.type !== 'error' && (
                  <div className="space-y-1.5">
                    {ADD_STEPS.map((def, idx) => {
                      const currentIdx = addStep.type === 'done' ? ADD_STEPS.length : ADD_STEPS.findIndex(s => s.key === addStep.type);
                      const isDone = idx < currentIdx;
                      const isCurrent = addStep.type !== 'done' && idx === currentIdx;
                      return (
                        <div key={def.key} className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${isCurrent ? 'bg-[var(--app-blue)]/10 text-[var(--app-blue-3)]' : isDone ? 'text-[var(--app-success)]' : 'text-[var(--app-muted)]'}`}>
                          {isDone ? (
                            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          ) : isCurrent ? (
                            <div className="w-4 h-4 flex-shrink-0 border-2 border-[var(--app-blue)] border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <div className="w-4 h-4 flex-shrink-0 rounded-full border border-[var(--app-border)]" />
                          )}
                          <span className="font-medium">{idx + 1}. {def.label}</span>
                          {isCurrent && <span className="ml-auto text-[10px] text-[var(--app-muted)]">sign...</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
                {addStep.type === 'error' && (
                  <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-3 py-2">{addStep.message}</div>
                )}
                {(addStep.type === 'done' || addStep.type === 'error') && (
                  <button onClick={resetAddStep} className="w-full py-2 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] rounded-xl text-sm font-medium hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] transition-colors">
                    {addStep.type === 'done' ? 'Add More Liquidity' : 'Try Again'}
                  </button>
                )}
              </div>
            )}
            <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-[var(--app-muted)]">{validTokenA.symbol}</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountA}
                  // [SECURITY] F-1: Sanitize input
                  onChange={e => setAmountA(sanitizeNumericInput(e.target.value))}
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
                {/* [BUG-FIX] Show helper hint for initial liquidity */}
                {isEmptyPool && (
                  <span className="text-xs text-[var(--app-blue-3)] font-medium">Set initial price ratio</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountB}
                  // [SECURITY] F-1: Sanitize input
                  // [BUG-FIX] Use proper conditional onChange: avoid comma operator pattern
                  onChange={isEmptyPool ? (e => {
                    const sanitized = sanitizeNumericInput(e.target.value);
                    setAmountB(sanitized);
                    setUserEditedB(true);
                  }) : undefined}
                  readOnly={!isEmptyPool}
                  placeholder={isEmptyPool ? '0.0 (set initial price)' : '0.0'}
                  className={`flex-1 bg-transparent text-2xl font-mono outline-none placeholder-[var(--app-muted-2)] ${!isEmptyPool ? 'opacity-70' : ''}`}
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
                   {/* [BUG-FIX] Guard BigInt division by zero for empty pool (reserveA = '0') */}
                   {!isEmptyPool && reserveA !== '0' && BigInt(reserveA) > 0n && amountA && amountA !== '0'
                     ? `${((BigInt(parseUnits(amountA, validTokenA.decimals)) * 100n) / BigInt(reserveA)).toString()}%`
                     : isEmptyPool ? '100%' : '0%'}
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
              onClick={() => {
                // [V7-FIX] If not connected, actually call connect() instead of
                // silently triggering handleAddLiquidity (which would fail)
                if (!isConnected) { connect(); return; }
                handleAddLiquidity();
              }}
              disabled={!isConnected ? false : (!amountA || !/^\d+(\.\d+)?$/.test(amountA.trim()) || Number(amountA) <= 0 || (isEmptyPool && (!amountB || !/^\d+(\.\d+)?$/.test(amountB.trim()) || Number(amountB) <= 0)) || loading)}
              className="w-full py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors"
            >
              {!isConnected ? 'Connect Wallet' : loading ? 'Processing...' : isEmptyPool ? 'Add Initial Liquidity' : 'Add Liquidity'}
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-3">
            {removeStep.type !== 'idle' && (
              <div className="bg-[var(--app-panel)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-[var(--app-text)]">
                    {removeStep.type === 'done' ? 'Liquidity Removed' : removeStep.type === 'error' ? 'Remove Failed' : 'Removing Liquidity'}
                  </span>
                  {removeStep.type !== 'done' && removeStep.type !== 'error' && (
                    <span className="text-xs font-mono text-[var(--app-muted)]">Step 1/1</span>
                  )}
                </div>
                {removeStep.type === 'removing' && (
                  <div className="h-1.5 bg-[var(--app-panel-soft)] rounded-full overflow-hidden border border-[var(--app-border)]">
                    <div className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)]" style={{ width: '50%' }} />
                  </div>
                )}
                {removeStep.type === 'removing' && (
                  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs bg-[var(--app-blue)]/10 text-[var(--app-blue-3)]">
                    <div className="w-4 h-4 flex-shrink-0 border-2 border-[var(--app-blue)] border-t-transparent rounded-full animate-spin" />
                    <span className="font-medium">1. Remove liquidity</span>
                    <span className="ml-auto text-[10px] text-[var(--app-muted)]">sign...</span>
                  </div>
                )}
                {removeStep.type === 'done' && (
                  <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs text-[var(--app-success)]">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    <span className="font-medium">1. Remove liquidity</span>
                  </div>
                )}
                {removeStep.type === 'error' && (
                  <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-3 py-2">{removeStep.message}</div>
                )}
                {(removeStep.type === 'done' || removeStep.type === 'error') && (
                  <button onClick={resetRemoveStep} className="w-full py-2 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] rounded-xl text-sm font-medium hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] transition-colors">
                    {removeStep.type === 'done' ? 'Done' : 'Try Again'}
                  </button>
                )}
              </div>
            )}
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
                {/* [SECURITY] F-9: Filter out zero-liquidity positions from the list */}
                {positions.filter(p => p.liquidity !== '0').map(pos => {
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
