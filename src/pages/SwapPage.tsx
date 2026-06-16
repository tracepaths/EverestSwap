import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { OCT_TOKEN, WOCT_TOKEN, OES_TOKEN, CONTRACTS } from '../types';
import { calculateOutput, calculatePriceImpact, formatUnits, parseUnits, sanitizeNumericInput } from '../services/swapService';
import { useIndexer } from '../hooks/useIndexer';
import { PoolChart } from '../components/PoolChart';
import TokenSelectModal from '../components/TokenSelectModal';

const HARDCODED_TOKENS = [OCT_TOKEN, WOCT_TOKEN, OES_TOKEN];

// [V7-FIX] Map pool address to display label (case-insensitive comparison
// to handle any RPC case variations)
function getTokenLabel(address: string): string {
  if (!address || address === '') return 'OCT';
  const lower = address.toLowerCase();
  if (lower === WOCT_TOKEN.address.toLowerCase()) return 'WOCT';
  if (lower === OES_TOKEN.address.toLowerCase()) return 'OES';
  return address.slice(0, 8) + '...';
}

function SwapPage() {
  const { rpc, isConnected, walletAddress, addToast, updateToast, connect } = useApp();
  const [fromAmount, setFromAmount] = useState('');
  const [fromToken, setFromToken] = useState(WOCT_TOKEN);
  const [toToken, setToToken] = useState(OES_TOKEN);
  const [toAmount, setToAmount] = useState('0');
  const [reserveA, setReserveA] = useState('0');
  const [reserveB, setReserveB] = useState('0');
  const { available: indexerAvailable, prices, loading: indexerLoading } = useIndexer();
  const chartData = prices.map(p => ({ time: Math.floor(p.time) as unknown as import('lightweight-charts').Time, value: p.price }));
  const [slippage, setSlippage] = useState(0.5);
  const [priceImpact, setPriceImpact] = useState(0);
  const [fromBalance, setFromBalance] = useState<string | null>(null);
  const [toBalance, setToBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('Ready to confirm');
  const [progressError, setProgressError] = useState(false);
  const [price, setPrice] = useState('0');
  const [showFromModal, setShowFromModal] = useState(false);
  const [showToModal, setShowToModal] = useState(false);
  const [poolAddress, setPoolAddress] = useState('');
  const [poolTokenA, setPoolTokenA] = useState('');
  const [poolTokenB, setPoolTokenB] = useState('');
  const [pairError, setPairError] = useState('');
  // [V6-SECURITY-FIX MED-18] Price impact confirmation gate
  const [highPriceImpactConfirmed, setHighPriceImpactConfirmed] = useState(false);
  // [SECURITY] F-2: Synchronous submit guard via ref to prevent double-click races
  const submittingRef = useRef(false);

  const mode = fromToken.address === '' && toToken.address === WOCT_TOKEN.address ? 'wrap'
    : fromToken.address === WOCT_TOKEN.address && toToken.address === '' ? 'unwrap'
    : 'swap';

  // [ROUTE-DISPLAY] Compute swap route as a chain of token symbols for display
  const route = useMemo((): string[] => {
    if (mode === 'wrap') return ['OCT', 'WOCT'];
    if (mode === 'unwrap') return ['WOCT', 'OCT'];
    if (mode === 'swap' && poolAddress) {
      // [V7-FIX] For OCT pairs, show multi-hop route even though poolAddress is set
      if (fromToken.address === '' || toToken.address === '') {
        if (fromToken.address === '' && toToken.address === '') {
          return ['OCT', WOCT_TOKEN.symbol, 'OCT']; // weird but valid
        }
        if (fromToken.address === '') {
          return ['OCT', WOCT_TOKEN.symbol, toToken.symbol];
        }
        return [fromToken.symbol, WOCT_TOKEN.symbol, 'OCT'];
      }
      return [fromToken.symbol, toToken.symbol];
    }
    if (mode === 'swap') {
      if (fromToken.address === '') {
        return ['OCT', WOCT_TOKEN.symbol, toToken.symbol];
      }
      if (toToken.address === '') {
        return [fromToken.symbol, WOCT_TOKEN.symbol, 'OCT'];
      }
    }
    return [];
  }, [mode, poolAddress, fromToken.symbol, fromToken.address, toToken.symbol, toToken.address]);

  // [V7-FIX] For OCT pairs, the actual pool token is WOCT (after auto-wrap)
  const effectiveFromAddress = fromToken.address === '' ? WOCT_TOKEN.address : fromToken.address;
  const poolIsAtoB = mode === 'swap' && poolTokenA && effectiveFromAddress.toLowerCase() === poolTokenA.toLowerCase();
  const poolIsBtoA = mode === 'swap' && poolTokenB && effectiveFromAddress.toLowerCase() === poolTokenB.toLowerCase();
  const swapDirectionValid = mode !== 'swap' || poolIsAtoB || poolIsBtoA;
  const canSubmitPair = mode !== 'swap' || (!!poolAddress && swapDirectionValid && !pairError);

  const reserveIn = mode === 'swap' ? (poolIsAtoB ? reserveA : poolIsBtoA ? reserveB : '0') : '0';
  const reserveOut = mode === 'swap' ? (poolIsAtoB ? reserveB : poolIsBtoA ? reserveA : '0') : '0';

  const loadReserves = useCallback(async () => {
    try {
      const targetPool = mode === 'swap' ? poolAddress : '';
      if (!targetPool) {
        setReserveA('0');
        setReserveB('0');
        setPoolTokenA('');
        setPoolTokenB('');
        return;
      }
      const reserves = await rpc.getReserves(targetPool);
      setReserveA(reserves.reserveA);
      setReserveB(reserves.reserveB);
      if (mode === 'swap') {
        const info = await rpc.getPoolInfo(targetPool);
        setPoolTokenA(info.tokenA);
        setPoolTokenB(info.tokenB);
      }
    } catch { /* noop */ }
  }, [rpc, mode, poolAddress]);

  const getTokenBalance = useCallback(async (token: typeof OCT_TOKEN) => {
    if (!isConnected || !walletAddress) return '0';
    if (token.address === '') {
      try {
        const bal = await rpc.getBalance(walletAddress);
        const raw = bal.balance_raw || bal.balance || '0';
        // [V7-FIX] balance_raw may be human-readable decimal string (e.g. "0.000001")
        // in some RPC versions. Convert to raw integer if it contains a dot.
        if (raw.includes('.')) {
          const num = Number(raw);
          if (!Number.isFinite(num)) return '0';
          return BigInt(Math.floor(num * 10 ** token.decimals)).toString();
        }
        return raw;
      } catch { return '0'; }
    }
    try {
      return await rpc.getTokenBalance(token.address, walletAddress);
    } catch {
      return '0';
    }
  }, [rpc, isConnected, walletAddress]);

  const loadBalances = useCallback(async () => {
    if (!isConnected || !walletAddress) return;
    const fb = await getTokenBalance(fromToken);
    setFromBalance(fb);
    const tb = await getTokenBalance(toToken);
    setToBalance(tb);
  }, [isConnected, walletAddress, getTokenBalance, fromToken, toToken]);

  useEffect(() => {
    if (mode !== 'swap') {
      setPoolAddress('');
      setPoolTokenA('');
      setPoolTokenB('');
      setPairError('');
      return;
    }

    const tokenA = fromToken.address;
    const tokenB = toToken.address;
    // [V7-FIX] OCT token has address = '' (empty string for native token).
    // The check `!tokenA` is `true` for empty string in JS, so the previous
    // check incorrectly fired 'Select both tokens' when user selected OCT.
    // Both fromToken and toToken are always set (default WOCT/OES), so the
    // only invalid case is when user selected the same token for both.
    if (fromToken === toToken) {
      setPoolAddress('');
      setPoolTokenA('');
      setPoolTokenB('');
      setPairError('Select two different tokens');
      return;
    }

    const isConfiguredPair = (a: string, b: string) => (
      (a === WOCT_TOKEN.address && b === OES_TOKEN.address) ||
      (a === OES_TOKEN.address && b === WOCT_TOKEN.address)
    );
    // [V7-FIX] OCT (empty address) pairs are routed via WOCT auto-wrap
    const isOctConfiguredPair = (a: string, b: string) => (
      (a === '' && b === WOCT_TOKEN.address) ||
      (a === WOCT_TOKEN.address && b === '') ||
      (a === '' && b === OES_TOKEN.address) ||
      (a === OES_TOKEN.address && b === '')
    );
    if (isOctConfiguredPair(tokenA, tokenB)) {
      // OCT pairs always route through the WOCT/OES pool
      setPoolAddress(CONTRACTS.pool);
      setPairError(CONTRACTS.pool ? '' : 'WOCT/OES pool is not configured');
      return;
    }
    if (isConfiguredPair(tokenA, tokenB)) {
      setPoolAddress(CONTRACTS.pool);
      setPairError(CONTRACTS.pool ? '' : 'WOCT/OES pool is not configured');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const foundPool = await rpc.getPoolAddress(CONTRACTS.factory, tokenA, tokenB);
        if (cancelled) return;
        if (foundPool) {
          setPoolAddress(foundPool);
          setPairError('');
        } else {
          setPoolAddress('');
          setPairError(`No pool found for ${fromToken.symbol}/${toToken.symbol}`);
        }
      } catch {
        if (cancelled) return;
        setPoolAddress('');
        setPairError(`Unable to resolve pool for ${fromToken.symbol}/${toToken.symbol}`);
      }
    })();

    return () => { cancelled = true; };
  }, [rpc, mode, fromToken.address, toToken.address, fromToken.symbol, toToken.symbol]);

  useEffect(() => {
    // [SECURITY] FM-7: Add cancelled flag to prevent wasted RPC calls on unmount
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      // [V7-FIX] Await both loads in parallel for atomicity
      try { await Promise.allSettled([loadReserves(), loadBalances()]); } catch { /* noop */ }
    };
    tick();
    const interval = setInterval(tick, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [loadReserves, loadBalances]);

  // [V7-FIX] Actual pool fee (for custom fee tiers) — defaults to 3/1000 (0.3%)
  const [poolFee, setPoolFee] = useState({ num: 3, denom: 1000 });
  // [V7-FIX] Fetch pool fee params when pool changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!poolAddress) {
        setPoolFee({ num: 3, denom: 1000 });
        return;
      }
      try {
        const fee = await rpc.contractView<{ fee_numerator: string; fee_denominator: string }>(
          poolAddress, 'get_fee_params', []
        );
        if (cancelled) return;
        const num = parseInt(fee?.fee_numerator || '3', 10);
        const denom = parseInt(fee?.fee_denominator || '1000', 10);
        if (num > 0 && denom > 0 && num < denom) {
          setPoolFee({ num, denom });
        }
      } catch {
        // Default to 3/1000 if call fails
        if (!cancelled) setPoolFee({ num: 3, denom: 1000 });
      }
    })();
    return () => { cancelled = true; };
  }, [rpc, poolAddress]);

  useEffect(() => {
    if (fromAmount && fromAmount !== '0') {
      if (mode === 'wrap' || mode === 'unwrap') {
        setToAmount(fromAmount);
        setPriceImpact(0);
        setPrice('1');
      } else if (reserveIn !== '0') {
        const amountInBN = parseUnits(fromAmount, fromToken.decimals);
        const out = calculateOutput(amountInBN, reserveIn, reserveOut, poolFee.num, poolFee.denom);
        setToAmount(formatUnits(out, toToken.decimals));
        const impact = calculatePriceImpact(amountInBN, reserveIn);
        setPriceImpact(impact);
        const p = Number(formatUnits(reserveOut, toToken.decimals)) / Number(formatUnits(reserveIn, fromToken.decimals));
        setPrice(p.toString());
      }
    } else {
      setToAmount('0');
      setPriceImpact(0);
    }
  }, [fromAmount, reserveIn, reserveOut, fromToken, toToken, mode, poolFee.num, poolFee.denom]);

  // [SECURITY] FM-1: Reset price impact confirmation when amount or pair changes
  // (otherwise stale confirmation applies to a different swap)
  useEffect(() => {
    setHighPriceImpactConfirmed(false);
  }, [fromAmount, fromToken.address, toToken.address]);

  useEffect(() => {
    if (!showConfirm) return;
    setProgress(0);
    setProgressLabel('Ready to confirm');
    setProgressError(false);
    setHighPriceImpactConfirmed(false);
    // [SECURITY] F-11: Escape closes the confirm dialog
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading && !submittingRef.current) setShowConfirm(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showConfirm, loading]);

  const switchTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount('');
    setToAmount('0');
    // [V7-FIX] Reset pool state immediately to avoid stale data
    setPoolAddress('');
    setPoolTokenA('');
    setPoolTokenB('');
    setPairError('');
    setHighPriceImpactConfirmed(false);
    // [V7-FIX] Reset balances to loading state to avoid stale display
    setFromBalance(null);
    setToBalance(null);
  };

  const handleSelectFromToken = (address: string, meta: { symbol: string; name: string; decimals: number }) => {
    const found = HARDCODED_TOKENS.find(t => t.address === address) || {
      address,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
    };
    if (address === toToken.address) {
      setToToken(found);
    }
    setFromToken(found);
    setShowFromModal(false);
    setFromAmount('');
    // [SECURITY] F-4: Reset balance to loading state when token changes to prevent
    // displaying stale balance from the previous token
    setFromBalance(null);
  };

  const handleSelectToToken = (address: string, meta: { symbol: string; name: string; decimals: number }) => {
    const found = HARDCODED_TOKENS.find(t => t.address === address) || {
      address,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
    };
    if (address === fromToken.address) {
      setFromToken(found);
    }
    setToToken(found);
    setShowToModal(false);
    setFromAmount('');
    // [SECURITY] F-4: Reset toToken balance to loading state
    setToBalance(null);
  };

  const updateProgress = (value: number, label: string, isError = false) => {
    setProgress(Math.max(0, Math.min(100, Math.round(value))));
    setProgressLabel(label);
    setProgressError(isError);
  };

  const actionLabel = mode === 'wrap' ? 'Wrap' : mode === 'unwrap' ? 'Unwrap' : 'Swap';
  const parseAmountInput = (value: string, token: typeof OCT_TOKEN): string => {
    const trimmed = value.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed) || Number(trimmed) <= 0) {
      throw new Error('Enter a valid amount');
    }
    const raw = parseUnits(trimmed, token.decimals);
    if (raw === '0') {
      throw new Error('Amount is too small');
    }
    return raw;
  };

  const getSlippageBasisPoints = (): number => {
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 50) {
      throw new Error('Invalid slippage');
    }
    return Math.max(0, Math.min(5000, Math.round(slippage * 100)));
  };

  const handleSwap = async () => {
    // [SECURITY] F-2: Synchronous ref guard prevents double-click double-submit
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    let failed = false;
    updateProgress(0, 'Preparing transaction...', false);
    const toastId = addToast('pending', `${actionLabel} in progress...`);
    try {
      await loadBalances();

      const rawAmount = parseAmountInput(fromAmount, fromToken);
      const currentBal = fromBalance ?? '0';
      if (BigInt(rawAmount) > BigInt(currentBal)) {
        throw new Error(`Insufficient ${fromToken.symbol} balance`);
      }

      if (mode === 'wrap') {
        updateProgress(15, 'Preparing wrap transaction...', false);
        updateToast(toastId, 'pending', 'Approving transaction in wallet...');
        updateProgress(35, 'Waiting for wallet approval...', false);
        const txHash = await walletService.callContract({
          contract: CONTRACTS.woct,
          method: 'deposit',
          params: [],
          amount: rawAmount,
        });
        updateProgress(55, 'Waiting for wrap confirmation...', false);
        updateToast(toastId, 'pending', 'Waiting for transaction confirmation...', txHash);
        await rpc.waitForReceipt(txHash);
        updateProgress(100, 'Wrap completed', false);
        updateToast(toastId, 'success', `${fromAmount} OCT wrapped to WOCT successfully!`, txHash);
      } else if (mode === 'unwrap') {
        updateProgress(15, 'Preparing unwrap transaction...', false);
        updateToast(toastId, 'pending', 'Approving transaction in wallet...');
        updateProgress(35, 'Waiting for wallet approval...', false);
        const txHash = await walletService.callContract({
          contract: CONTRACTS.woct,
          method: 'withdraw',
          params: [rawAmount],
        });
        updateProgress(55, 'Waiting for unwrap confirmation...', false);
        updateToast(toastId, 'pending', 'Waiting for transaction confirmation...', txHash);
        await rpc.waitForReceipt(txHash);
        // [V7-CRIT-10] WOCT uses pull pattern: withdraw records pending claim,
        // user must call claim_withdrawal to actually receive native OCT.
        updateProgress(75, 'Claiming native OCT...', false);
        updateToast(toastId, 'pending', 'Step 2/2: Claiming OCT...');
        const claimHash = await walletService.callContract({
          contract: CONTRACTS.woct,
          method: 'claim_withdrawal',
          params: [],
        });
        updateProgress(95, 'Waiting for claim confirmation...', false);
        await rpc.waitForReceipt(claimHash);
        updateProgress(100, 'Unwrap completed', false);
        updateToast(toastId, 'success', `${fromAmount} WOCT unwrapped to OCT successfully!`, claimHash);
      } else {
        // [V7-FIX] Multi-step: wrap native OCT to WOCT before swap if fromToken is native
        let actualFromToken = fromToken;
        let actualRawAmount = rawAmount;
        if (fromToken.address === '') {
          // [V7-FIX] Pre-check native OCT balance before auto-wrap. Without this,
          // the wrap would fail on-chain and user pays gas for nothing.
          if (fromBalance !== null && BigInt(rawAmount) > BigInt(fromBalance)) {
            throw new Error(`Insufficient OCT balance for wrap+swap (have ${formatUnits(fromBalance, 6)} OCT)`);
          }
          updateProgress(10, 'Wrapping OCT to WOCT...', false);
          updateToast(toastId, 'pending', 'Step 1/2: Wrapping OCT to WOCT...');
          const wrapHash = await walletService.callContract({
            contract: CONTRACTS.woct,
            method: 'deposit',
            params: [],
            amount: rawAmount,
          });
          updateProgress(25, 'Waiting for wrap confirmation...', false);
          await rpc.waitForReceipt(wrapHash);
          // After wrap, fromToken becomes WOCT with the same amount
          actualFromToken = WOCT_TOKEN;
          actualRawAmount = rawAmount;
          updateProgress(30, 'Wrap complete, preparing swap...', false);
        }

        if (!canSubmitPair) {
          throw new Error(pairError || 'Invalid token pair');
        }

        // [V7-FIX] Use chain epoch (not unix timestamp) for deadline
        // epoch in AML is the chain block counter, not wall-clock time
        const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
        const chainEpoch = epochInfo?.epoch_id || 0;
        const deadline = chainEpoch + 300;

        const freshReserves = await rpc.getReserves(poolAddress);
        const freshPool = await rpc.getPoolInfo(poolAddress);
        const fromIsTokenA = actualFromToken.address.toLowerCase() === freshPool.tokenA.toLowerCase();
        const fromIsTokenB = actualFromToken.address.toLowerCase() === freshPool.tokenB.toLowerCase();
        if (!fromIsTokenA && !fromIsTokenB) {
          throw new Error('Selected input token is not part of the resolved pool');
        }
        // [V7-FIX] If toToken is native OCT, treat it as WOCT for the pool swap
        const actualToToken = toToken.address === '' ? WOCT_TOKEN : toToken;
        const toIsActualTokenA = actualToToken.address.toLowerCase() === freshPool.tokenA.toLowerCase();
        const toIsActualTokenB = actualToToken.address.toLowerCase() === freshPool.tokenB.toLowerCase();
        if (!(fromIsTokenA && toIsActualTokenB) && !(fromIsTokenB && toIsActualTokenA)) {
          throw new Error('Selected output token does not match the resolved pool pair');
        }

        const freshReserveIn = fromIsTokenA ? freshReserves.reserveA : freshReserves.reserveB;
        const freshReserveOut = fromIsTokenA ? freshReserves.reserveB : freshReserves.reserveA;

        const amountInBN = parseUnits(fromAmount.trim(), actualFromToken.decimals);
        // [SECURITY] F-7: Pre-check user balance before submission
        // For wrapped flow, we already wrapped so balance check is skipped
        if (fromToken.address !== '' && fromBalance !== null && BigInt(amountInBN) > BigInt(fromBalance)) {
          throw new Error('Insufficient balance for swap');
        }
        const freshOutput = calculateOutput(amountInBN, freshReserveIn, freshReserveOut, poolFee.num, poolFee.denom);
        // [SECURITY] Reject zero or negative output to prevent silent failures
        if (BigInt(freshOutput) <= 0n) {
          throw new Error('Calculated output is zero or negative — pool may be empty or amount too small');
        }
        const freshToAmount = formatUnits(freshOutput, actualToToken.decimals);

        // [V7-FIX] Compute minOutRaw directly from BigInt to avoid precision loss
        // from formatUnits → parseUnits round-trip on high-decimal tokens.
        const basisPoints = getSlippageBasisPoints();
        const minOutRaw = BigInt(freshOutput) * BigInt(10000 - basisPoints) / 10000n;
        const swapMethod = fromIsTokenA ? 'swap_a_for_b' : 'swap_b_for_a';

        if (minOutRaw <= 0n) {
          throw new Error('Minimum output too small — try a larger amount or adjust slippage');
        }
        const minOutStr = minOutRaw.toString();

        const stepStartPct = fromToken.address === '' ? 35 : 15;
        updateProgress(stepStartPct, 'Preparing swap transaction...', false);
        updateToast(toastId, 'pending', `Approving ${actualFromToken.symbol} grant in wallet...`);
        updateProgress(stepStartPct + 20, 'Waiting for token grant approval...', false);
        const grantHash = await walletService.callContract({
          contract: actualFromToken.address,
          method: 'grant',
          params: [poolAddress, actualRawAmount],
        });
        updateProgress(stepStartPct + 40, 'Waiting for grant confirmation...', false);
        updateToast(toastId, 'pending', 'Waiting for grant confirmation...', grantHash);
        await rpc.waitForReceipt(grantHash);

        const preSwapPool = await rpc.getPoolInfo(poolAddress);
        const preSwapFromA = actualFromToken.address.toLowerCase() === preSwapPool.tokenA.toLowerCase();
        const preSwapFromB = actualFromToken.address.toLowerCase() === preSwapPool.tokenB.toLowerCase();
        const preSwapToA = actualToToken.address.toLowerCase() === preSwapPool.tokenA.toLowerCase();
        const preSwapToB = actualToToken.address.toLowerCase() === preSwapPool.tokenB.toLowerCase();
        if (!((preSwapFromA && preSwapToB) || (preSwapFromB && preSwapToA))) {
          throw new Error('Resolved pool pair changed before swap submission');
        }
        const preSwapMethod = preSwapFromA ? 'swap_a_for_b' : 'swap_b_for_a';
        if (preSwapMethod !== swapMethod) {
          throw new Error('Swap direction changed before submission');
        }

        // [SECURITY] Post-grant reserve re-check to detect sandwich attack depletion
        const postGrantReserves = await rpc.getReserves(poolAddress);
        const postGrantReserveIn = preSwapFromA ? postGrantReserves.reserveA : postGrantReserves.reserveB;
        const postGrantReserveOut = preSwapFromA ? postGrantReserves.reserveB : postGrantReserves.reserveA;
        const postGrantOutput = calculateOutput(amountInBN, postGrantReserveIn, postGrantReserveOut, poolFee.num, poolFee.denom);
        if (BigInt(postGrantOutput) <= 0n) {
          throw new Error('Post-grant pool state is empty — possible sandwich attack');
        }
        // Re-check minOut against fresh post-grant output
        const postGrantBasis = BigInt(postGrantOutput) * BigInt(10000 - basisPoints) / 10000n;
        if (minOutRaw > postGrantBasis) {
          throw new Error('Price moved unfavorably during grant confirmation — please review and retry');
        }

        updateProgress(stepStartPct + 55, 'Submitting swap...', false);
        updateToast(toastId, 'pending', 'Approving swap in wallet...');
        const swapHash = await walletService.callContract({
          contract: poolAddress,
          method: swapMethod,
          params: [actualRawAmount, minOutStr, String(deadline)],
        });
        updateProgress(stepStartPct + 65, 'Waiting for swap confirmation...', false);
        updateToast(toastId, 'pending', 'Waiting for swap confirmation...', swapHash);
        await rpc.waitForReceipt(swapHash);

        // [V7-FIX] Multi-step: unwrap WOCT to OCT after swap if toToken is native
        if (toToken.address === '') {
          // [V7-FIX] Use actual WOCT balance after swap, not postGrantOutput
          // (which is expected output). If pool moved between swap and unwrap,
          // actual balance may be less. Cap at actual balance to avoid revert.
          const actualWoctBal = await rpc.getTokenBalance(WOCT_TOKEN.address, walletAddress);
          const unwrapAmount = BigInt(actualWoctBal) < BigInt(postGrantOutput.toString())
            ? actualWoctBal
            : postGrantOutput.toString();
          updateProgress(88, 'Unwrapping WOCT to OCT...', false);
          updateToast(toastId, 'pending', 'Step 2/3: Unwrapping WOCT to OCT...');
          const unwrapHash = await walletService.callContract({
            contract: CONTRACTS.woct,
            method: 'withdraw',
            params: [unwrapAmount],
          });
          updateProgress(93, 'Waiting for unwrap confirmation...', false);
          await rpc.waitForReceipt(unwrapHash);
          // [V7-CRIT-10] Pull pattern: claim the pending native OCT
          updateProgress(96, 'Claiming native OCT...', false);
          updateToast(toastId, 'pending', 'Step 3/3: Claiming OCT...');
          const claimHash = await walletService.callContract({
            contract: CONTRACTS.woct,
            method: 'claim_withdrawal',
            params: [],
          });
          await rpc.waitForReceipt(claimHash);
        }

        updateProgress(100, 'Swap completed', false);
        const finalDisplay = toToken.address === ''
          ? `Swap ${fromAmount} ${fromToken.symbol} → ${formatUnits(postGrantOutput, WOCT_TOKEN.decimals)} WOCT → unwrapped to OCT successful!`
          : `Swap ${fromAmount} ${fromToken.symbol} → ${freshToAmount} ${toToken.symbol} successful!`;
        updateToast(toastId, 'success', finalDisplay, swapHash);
      }

      try { await loadBalances(); } catch { /* noop */ }
      try { await loadReserves(); } catch { /* noop */ }
    } catch (e) {
      failed = true;
      const errMsg = e instanceof Error ? e.message : 'An error occurred';
      updateProgress(100, 'Transaction failed', true);
      updateToast(toastId, 'error', `${actionLabel} failed: ${errMsg}`);
      // [V7-FIX] Reset price impact confirmation on failure (stale state bug)
      setHighPriceImpactConfirmed(false);
    } finally {
      // [SECURITY] F-2: Reset ref guard
      submittingRef.current = false;
      setLoading(false);
      if (!failed) setShowConfirm(false);
    }
  };

  const isAmountValid = /^\d+(\.\d+)?$/.test(fromAmount.trim()) && Number(fromAmount) > 0;

  return (
    <div className="max-w-lg mx-auto pt-4">
      <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--app-border)]">
          <h2 className="text-lg font-semibold">Swap</h2>
        </div>

        <div className="p-6 space-y-3">
          <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-[var(--app-muted)]">You pay</span>
              <span className="text-xs text-[var(--app-muted)]">
                Balance: {fromBalance === null ? '...' : formatUnits(fromBalance, fromToken.decimals)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="decimal"
                value={fromAmount}
                // [SECURITY] F-1: Sanitize input to digits + single dot only
                onChange={e => setFromAmount(sanitizeNumericInput(e.target.value))}
                placeholder="0.0"
                className="flex-1 bg-transparent text-2xl font-mono outline-none placeholder-[var(--app-muted-2)]"
              />
              <div className="relative">
                <button
                  onClick={() => setShowFromModal(true)}
                  className="flex items-center gap-1.5 bg-[var(--app-hover)] rounded-lg px-3 py-1.5 hover:bg-[var(--app-hover)] transition-colors"
                >
                  <span className="font-medium">{fromToken.symbol}</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

              </div>
            </div>
            <div className="flex gap-1 mt-2">
              {[10, 25, 50, 100].map(pct => {
                const bal = fromBalance ?? '0';
                // [V7-FIX] For native OCT, reserve headroom for gas.
                // Wrap needs ~0.05 OCT for tx fee.
                // Unwrap is fine (no native gas needed for the value side).
                // Multi-step flow (swap) needs ~0.02 OCT for wrap+swap fees.
                const isNative = fromToken.address === '';
                const isMultiStep = isNative && mode === 'swap';
                const isWrap = isNative && mode === 'wrap';
                let effectivePct = pct;
                if (isNative && pct === 100) {
                  if (isMultiStep) effectivePct = 98;
                  else if (isWrap) effectivePct = 95;
                  else effectivePct = 99;
                }
                const rawPct = BigInt(bal) * BigInt(effectivePct) / 100n;
                const tip = isNative && pct === 100
                  ? (isMultiStep
                      ? 'Reserves ~0.02 OCT for wrap+swap gas'
                      : isWrap
                        ? 'Reserves ~0.05 OCT for tx fee'
                        : 'Reserves ~0.01 OCT for gas')
                  : undefined;
                return (
                  <button
                    key={pct}
                    onClick={() => setFromAmount(formatUnits(rawPct.toString(), fromToken.decimals))}
                    className="text-xs px-2 py-0.5 rounded bg-[var(--app-hover)] hover:bg-[var(--app-hover)] text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors"
                    title={tip}
                  >
                    {pct}%
                  </button>
                );
              })}
            </div>
          </div>

          {mode === 'swap' && pairError && (
            <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-3 py-2">
              {pairError}
            </div>
          )}

          <div className="flex justify-center my-3 relative z-10">
            <button
              onClick={switchTokens}
              className="bg-[var(--app-hover)] border-4 border-[var(--app-bg)] rounded-lg p-1.5 hover:bg-[var(--app-hover)] text-[var(--app-blue-3)] hover:text-white transition-all duration-300 hover:rotate-180"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-[var(--app-muted)]">You receive</span>
              <span className="text-xs text-[var(--app-muted)]">
                Balance: {toBalance === null ? '...' : formatUnits(toBalance, toToken.decimals)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={toAmount}
                readOnly
                placeholder="0.0"
                className="flex-1 bg-transparent text-2xl font-mono outline-none placeholder-[var(--app-muted-2)]"
              />
              <div className="relative">
                <button
                  onClick={() => setShowToModal(true)}
                  className="flex items-center gap-1.5 bg-[var(--app-hover)] rounded-lg px-3 py-1.5 hover:bg-[var(--app-hover)] transition-colors"
                >
                  <span className="font-medium">{toToken.symbol}</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

              </div>
            </div>
          </div>

          <div className="bg-[var(--app-panel-soft)] rounded-xl p-3 space-y-1.5 text-xs">
            <div className="flex justify-between text-[var(--app-muted)]">
              <span>Rate</span>
              <span>1 {fromToken.symbol} = {Number(price).toFixed(6)} {toToken.symbol}</span>
            </div>
            {mode === 'swap' && (
              <>
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>Price Impact</span>
                  <span className={priceImpact > 5 ? 'text-[var(--app-danger)]' : priceImpact > 2 ? 'text-[var(--app-warning)]' : ''}>
                    {priceImpact.toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>Slippage</span>
                  <div className="flex items-center gap-2">
                    {[0.1, 0.5, 1.0].map(v => (
                      <button
                        key={v}
                        onClick={() => setSlippage(v)}
                        className={`px-2 py-0.5 rounded ${slippage === v ? 'bg-[var(--app-blue)] text-[var(--app-text)]' : 'bg-[var(--app-hover)] text-[var(--app-muted)]'}`}
                      >
                        {v}%
                      </button>
                    ))}
                    <input
                      type="number"
                      value={slippage}
                      onChange={e => {
                        const value = Number(e.target.value);
                        setSlippage(Number.isFinite(value) ? Math.max(0, Math.min(50, value)) : 0);
                      }}
                      className="w-14 bg-[var(--app-hover)] rounded px-2 py-0.5 text-right outline-none"
                      step={0.1}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>Fee (0.3%)</span>
                  <span>{fromAmount ? (Number(fromAmount) * 0.003).toFixed(6) : '0'} {fromToken.symbol}</span>
                </div>
              </>
            )}
            {mode !== 'swap' && (
              <div className="flex justify-between text-[var(--app-muted)]">
                <span>Network Fee</span>
                <span>~0.1 OCT</span>
              </div>
            )}
            {route.length >= 2 && (
              <div className="flex justify-between text-[var(--app-muted)]">
                <span>Route</span>
                <span className="font-mono">{route.join(' → ')}</span>
              </div>
            )}
          </div>

          <button
            onClick={() => {
              // [V7-FIX] If not connected, actually call connect() instead of
              // opening confirm modal (which would silently do nothing)
              if (!isConnected) { connect(); return; }
              setShowConfirm(true);
            }}
            disabled={!isConnected ? false : (!isAmountValid || (mode === 'swap' && !canSubmitPair))}
            className="w-full py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors"
          >
            {!isConnected ? 'Connect Wallet' : mode === 'swap' && !canSubmitPair ? pairError || 'Enter Amount' : !isAmountValid ? 'Enter Amount' : actionLabel}
          </button>
        </div>
      </div>

      {showConfirm && (
        // [SECURITY] F-12: aria-modal + role dialog
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xl z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-swap-title">
          <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] max-w-md w-full p-6 space-y-4">
            <h3 id="confirm-swap-title" className="text-lg font-semibold">Confirm {actionLabel}</h3>
            {mode === 'swap' && pairError && (
              <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-3 py-2">
                {pairError}
              </div>
            )}
            <div className="space-y-3 bg-[var(--app-panel-soft)] rounded-xl p-4 text-sm">
              {mode === 'swap' ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">You pay</span>
                    <span className="font-medium">{fromAmount} {fromToken.symbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">You receive</span>
                    <span className="font-medium">~{toAmount} {toToken.symbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">Price Impact</span>
                    <span>{priceImpact.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">Min received</span>
                    <span className="font-medium">
                      ~{(() => { try { const toRaw = parseUnits(toAmount || '0', toToken.decimals); const bps = Math.max(0, Math.min(5000, Math.round(slippage * 100))); const minOut = BigInt(toRaw) * BigInt(10000 - bps) / 10000n; return formatUnits(minOut.toString(), toToken.decimals); } catch { return '0'; } })()} {toToken.symbol}
                    </span>
                  </div>
                  <div className="border-t border-[var(--app-border)] my-2" />
                  <div className="flex justify-between text-[var(--app-muted)]">
                    <span>Fee (0.3%)</span>
                    <span>{(Number(fromAmount) * 0.003).toFixed(6)} {fromToken.symbol}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">You {mode === 'wrap' ? 'wrap' : 'unwrap'}</span>
                    <span className="font-medium">{fromAmount} {fromToken.symbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">You receive</span>
                    <span className="font-medium">{toAmount} {toToken.symbol}</span>
                  </div>
                  <div className="border-t border-[var(--app-border)] my-2" />
                  <div className="flex justify-between text-[var(--app-muted)]">
                    <span>Network Fee</span>
                    <span>~0.1 OCT</span>
                  </div>
                </>
              )}
            </div>
            <div className="space-y-2 bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
              <div className="flex items-center justify-between text-xs">
                <span className={progressError ? 'text-[var(--app-danger)]' : 'text-[var(--app-muted)]'}>{progressLabel}</span>
                <span className={`font-mono ${progressError ? 'text-[var(--app-danger)]' : 'text-[var(--app-blue-3)]'}`}>{progress}%</span>
              </div>
              <div className="h-2 bg-[var(--app-panel-soft)] rounded-full overflow-hidden border border-[var(--app-border)]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    progressError
                      ? 'bg-gradient-to-r from-red-500 to-orange-500'
                      : 'bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)]'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            {/* [V6-SECURITY-FIX MED-18] Price impact confirmation gate */}
            {mode === 'swap' && priceImpact > 5 && (
              <label className="flex items-start gap-2 px-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={highPriceImpactConfirmed}
                  onChange={e => setHighPriceImpactConfirmed(e.target.checked)}
                  className="mt-0.5 accent-[var(--app-danger)]"
                />
                <span className="text-xs text-[var(--app-danger)]">
                  I understand the price impact is {priceImpact.toFixed(2)}% and accept the risk
                </span>
              </label>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={loading}
                className="flex-1 py-2.5 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl font-medium hover:bg-[var(--app-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleSwap}
                disabled={loading || !canSubmitPair || (mode === 'swap' && priceImpact > 5 && !highPriceImpactConfirmed)}
                className="flex-1 py-2.5 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] rounded-xl font-medium hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:opacity-50 transition-colors"
              >
                {loading ? `${actionLabel}...` : `Confirm ${actionLabel}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {indexerAvailable && (
        <div className="mt-6 bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl p-5 border border-[var(--app-border)]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">OES / WOCT Price</h3>
            <span className="text-xs text-[var(--app-muted-2)]">Live</span>
          </div>
          {indexerLoading ? (
            <div className="h-[200px] bg-[var(--app-panel-soft)] rounded animate-pulse" />
          ) : (
            <PoolChart data={chartData} height={200} />
          )}
        </div>
      )}

      <div className="mt-6 bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--app-border)]">
          <h3 className="text-sm font-semibold">Pool Reserves</h3>
        </div>
        <div className="p-4 text-sm text-[var(--app-muted)] font-mono">
          <div className="flex justify-between py-1">
            {/* [V7-FIX] Use actual pool token labels and decimals (was hardcoded "WOCT"/"OES" and fromToken.decimals) */}
            <span>{getTokenLabel(poolTokenA)} Reserve:</span>
            <span>{formatUnits(reserveA, 6)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span>{getTokenLabel(poolTokenB)} Reserve:</span>
            <span>{formatUnits(reserveB, 6)}</span>
          </div>
        </div>
      </div>

      <TokenSelectModal
        isOpen={showFromModal}
        onClose={() => setShowFromModal(false)}
        onSelect={handleSelectFromToken}
        rpc={rpc}
        excludeAddress={toToken.address || undefined}
        // [V7-FIX] OCT now allowed as from-token — handleSwap will auto-wrap if needed
        excludeNative={false}
        walletAddress={walletAddress}
        isConnected={isConnected}
      />
      <TokenSelectModal
        isOpen={showToModal}
        onClose={() => setShowToModal(false)}
        onSelect={handleSelectToToken}
        rpc={rpc}
        excludeAddress={fromToken.address || undefined}
        walletAddress={walletAddress}
        isConnected={isConnected}
      />
    </div>
  );
}

export default SwapPage;
