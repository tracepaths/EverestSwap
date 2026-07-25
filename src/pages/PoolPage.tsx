import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import type { OctraRpc } from '../services/octraRpc';
import { CONTRACTS, WOCT_TOKEN } from '../types';
import { formatUnits, parseUnits, sanitizeNumericInput, parseRawBalance } from '../services/swapService';
import { walletService } from '../services/walletService';
import TokenSelectModal from '../components/TokenSelectModal';
import LoadingModal from '../components/LoadingModal';
import { usePriceService } from '../hooks/usePriceService';

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

interface TokenMeta {
  symbol: string;
  name: string;
  decimals: number;
}

type CreateStep =
  | { type: 'idle' }
  | { type: 'compiling' }
  | { type: 'computing_address' }
  | { type: 'deploying' }
  | { type: 'setting_tokens' }
  | { type: 'setting_reward' }
  | { type: 'setting_fee' }
  | { type: 'registering' }
  | { type: 'granting_reward' }
  | { type: 'granting_a' }
  | { type: 'granting_b' }
  | { type: 'adding_liquidity' }
  | { type: 'done'; poolAddress: string; rewardInfo?: { rewardToken: string; rewardAmount: string; duration: number } }
  | { type: 'error'; message: string };

function CreatePoolForm({ rpc, isConnected, onPoolCreated, connect, walletAddress }: {
  rpc: OctraRpc;
  isConnected: boolean;
  onPoolCreated: () => void;
  connect: () => void | Promise<void>;
  walletAddress: string;
}) {
  const navigate = useNavigate();
  const [tokenA, setTokenA] = useState('');
  const [tokenB, setTokenB] = useState('');
  const [metaA, setMetaA] = useState<TokenMeta | null>(null);
  const [metaB, setMetaB] = useState<TokenMeta | null>(null);
  const [balanceA, setBalanceA] = useState<string | null>(null);
  const [balanceB, setBalanceB] = useState<string | null>(null);
  const [showTokenASelect, setShowTokenASelect] = useState(false);
  const [showTokenBSelect, setShowTokenBSelect] = useState(false);
  const [hasValidPair, setHasValidPair] = useState(false);
  const [feeTier, setFeeTier] = useState<'0.01' | '0.05' | '0.30' | '1.00' | 'custom'>('0.30');
  const [customNum, setCustomNum] = useState('3');
  const [customDenom, setCustomDenom] = useState('1000');
  const [initAmountA, setInitAmountA] = useState('');
  const [initAmountB, setInitAmountB] = useState('');
  const [step, setStep] = useState<CreateStep>({ type: 'idle' });
  // [V6-SECURITY-FIX MED-13] Double-submit guard
  const [creating, setCreating] = useState(false);
  // [V9] Reward Pool state
  const [poolType, setPoolType] = useState<'standard' | 'reward'>('standard');
  const [rewardToken, setRewardToken] = useState('');
  const [rewardMeta, setRewardMeta] = useState<TokenMeta | null>(null);
  const [rewardAmount, setRewardAmount] = useState('');
  const [rewardDuration, setRewardDuration] = useState<number>(432000);
  const [creatorLockDays, setCreatorLockDays] = useState(7);
  const [showRewardSelect, setShowRewardSelect] = useState(false);
  const [rewardBalance, setRewardBalance] = useState<string | null>(null);

  const mountedRef = useRef(true);
  // [SECURITY] F-2: Synchronous submit guard (creating state is async, race exists)
  const createSubmittingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!tokenA || !tokenB) { setHasValidPair(false); return; }
    // [V7-FIX] If either token IS WOCT, the pool IS the WOCT pair — always valid
    if (tokenA === WOCT_TOKEN.address || tokenB === WOCT_TOKEN.address) {
      setHasValidPair(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const factoryAddr = CONTRACTS.factory;
      const woctAddr = WOCT_TOKEN.address;
      const tokenAHasPool = await rpc.hasExistingPool(factoryAddr, woctAddr, tokenA);
      if (cancelled) return;
      if (tokenAHasPool) { setHasValidPair(true); return; }
      const tokenBHasPool = await rpc.hasExistingPool(factoryAddr, woctAddr, tokenB);
      if (cancelled) return;
      setHasValidPair(tokenBHasPool);
    })();
    return () => { cancelled = true; };
  }, [rpc, tokenA, tokenB]);

  // [SECURITY] F-4: Check if the EXACT pair (tokenA, tokenB) already has a pool.
  // If it does, the deploy will succeed but register_pool will revert. Warn the user.
  const [pairAlreadyExists, setPairAlreadyExists] = useState(false);
  useEffect(() => {
    if (!tokenA || !tokenB || tokenA === tokenB) { setPairAlreadyExists(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const factoryAddr = CONTRACTS.factory;
        const poolAddr = await rpc.getPoolAddress(factoryAddr, tokenA, tokenB);
        if (cancelled) return;
        setPairAlreadyExists(!!poolAddr && poolAddr !== '');
      } catch {
        if (!cancelled) setPairAlreadyExists(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rpc, tokenA, tokenB]);

  // [V7-PASS10] LOW-28: prevent selecting the same token for both A and B
  const handleSelectTokenA = (address: string, meta: TokenMeta) => {
    if (address === tokenB) return;
    setTokenA(address);
    setMetaA(meta);
    setInitAmountA('');
    // Fetch balance
    if (walletAddress) {
      if (address === '') {
        rpc.getBalance(walletAddress).then(bal => { if (mountedRef.current) setBalanceA(parseRawBalance(bal.balance_raw, 6)); }).catch(() => { if (mountedRef.current) setBalanceA(null); });
      } else {
        rpc.getTokenBalance(address, walletAddress).then(bal => { if (mountedRef.current) setBalanceA(bal); }).catch(() => { if (mountedRef.current) setBalanceA(null); });
      }
    }
  };

  const handleSelectTokenB = (address: string, meta: TokenMeta) => {
    if (address === tokenA) return;
    setTokenB(address);
    setMetaB(meta);
    setInitAmountB('');
    // Fetch balance
    if (walletAddress) {
      if (address === '') {
        rpc.getBalance(walletAddress).then(bal => { if (mountedRef.current) setBalanceB(parseRawBalance(bal.balance_raw, 6)); }).catch(() => { if (mountedRef.current) setBalanceB(null); });
      } else {
        rpc.getTokenBalance(address, walletAddress).then(bal => { if (mountedRef.current) setBalanceB(bal); }).catch(() => { if (mountedRef.current) setBalanceB(null); });
      }
    }
  };

  // [V9] Reward token selection handler
  const handleSelectRewardToken = (address: string, meta: TokenMeta) => {
    setRewardToken(address);
    setRewardMeta(meta);
    setRewardAmount('');
    if (walletAddress) {
      rpc.getTokenBalance(address, walletAddress).then(bal => { if (mountedRef.current) setRewardBalance(bal); }).catch(() => { if (mountedRef.current) setRewardBalance(null); });
    }
  };

  const getFeeParams = (): { num: number; denom: number } => {
    if (feeTier === '0.01') return { num: 1, denom: 10000 };
    if (feeTier === '0.05') return { num: 5, denom: 10000 };
    if (feeTier === '1.00') return { num: 100, denom: 10000 };
    if (feeTier === 'custom') {
      const num = parseInt(customNum, 10) || 3;
      const denom = parseInt(customDenom, 10) || 1000;
      // [V6-SECURITY-FIX MED-10] Validate fee params
      if (num <= 0 || denom <= 0 || num >= denom) {
        throw new Error('Invalid fee: numerator must be > 0 and < denominator');
      }
      // [V7-FIX] Validate fee range matches contract: 0.03% <= fee <= 1%
      // Contract: num * 10000 >= denom * 3 AND num * 1000 <= denom * 10
      if (num * 10000 < denom * 3) {
        throw new Error('Fee too low (min 0.03%, e.g. 3/10000)');
      }
      if (num * 1000 > denom * 10) {
        throw new Error('Fee too high (max 1%, e.g. 10/1000)');
      }
      return { num, denom };
    }
    return { num: 3, denom: 1000 };
  };

  const handleCreatePool = async () => {
    if (!tokenA || !tokenB) return;
    // [V6-SECURITY-FIX MED-13] Double-submit guard
    if (creating) return;
    // [SECURITY] F-2: Synchronous ref guard to prevent double-click double-submit
    if (createSubmittingRef.current) return;
    createSubmittingRef.current = true;
    setCreating(true);
    // [SECURITY] FM-5: Helper to safely set step only if component is still mounted
    const safeSetStep = (s: typeof step) => {
      if (mountedRef.current) setStep(s);
    };
    // [V7-PASS10] HIGH-8: pre-flight check for paused/blacklisted tokens.
    // Catches before deploy so user doesn't waste gas on a pool that will fail
    // at the grant step due to paused/blacklist checks.
    // tokenA/tokenB are address strings; resolve to symbols via getTokenMeta when needed.
    try {
      const resolveSym = async (addr: string): Promise<string> => {
        try { const m = await rpc.getTokenMeta(addr); return m.symbol; } catch { return addr.slice(0, 6); }
      };
      const userAddr = walletService.address || '';
      if (tokenA) {
        const statusA = await rpc.getTokenStatus(tokenA, userAddr);
        if (statusA.paused) {
          const symA = await resolveSym(tokenA);
          safeSetStep({ type: 'error', message: `${symA} is paused — cannot create pool` });
          createSubmittingRef.current = false;
          setCreating(false);
          return;
        }
        if (statusA.blacklisted) {
          const symA = await resolveSym(tokenA);
          safeSetStep({ type: 'error', message: `Your wallet is blacklisted from ${symA}` });
          createSubmittingRef.current = false;
          setCreating(false);
          return;
        }
      }
      if (tokenB) {
        const statusB = await rpc.getTokenStatus(tokenB, userAddr);
        if (statusB.paused) {
          const symB = await resolveSym(tokenB);
          safeSetStep({ type: 'error', message: `${symB} is paused — cannot create pool` });
          createSubmittingRef.current = false;
          setCreating(false);
          return;
        }
        if (statusB.blacklisted) {
          const symB = await resolveSym(tokenB);
          safeSetStep({ type: 'error', message: `Your wallet is blacklisted from ${symB}` });
          createSubmittingRef.current = false;
          setCreating(false);
          return;
        }
      }
    } catch { /* noop — proceed if status fetch fails */ }
    const factoryAddr = CONTRACTS.factory;
    if (!factoryAddr) {
      safeSetStep({ type: 'error', message: 'Factory contract not configured' });
      // [V7-FIX] Reset ref guard on early return to prevent permanent button death
      createSubmittingRef.current = false;
      setCreating(false);
      return;
    }
    // [SECURITY] F-6: Snapshot the wallet address at the start of the flow.
    // If the wallet disconnects/changes account mid-flow, the deploy contract
    // address and subsequent transactions will use the wrong identity.
    const walletSnapshot = walletService.address;
    if (!walletSnapshot) {
      safeSetStep({ type: 'error', message: 'Wallet not connected' });
      // [V7-FIX] Reset ref guard on early return
      createSubmittingRef.current = false;
      setCreating(false);
      return;
    }

    // [V7-FIX] Pre-check balance before starting — pool creation costs
    // ~1+ OCT for deploy + 5 init txs. Fail fast with clear message.
    try {
      const bal = await rpc.getBalance(walletService.address);
      // Need at least 1 OCT (1_000_000 base units at 6 decimals) to safely cover deploy + 5 txs + fees
      const minRequired = 1000000n;
      const rawOCT = parseRawBalance(bal.balance_raw, 6);
      if (BigInt(rawOCT) < minRequired) {
        const octBal = Number(rawOCT) / 1_000_000;
        throw new Error(
          `Insufficient OCT for pool creation. Need at least 1 OCT, have ${octBal.toFixed(6)} OCT.`
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Insufficient')) {
        safeSetStep({ type: 'error', message: e.message });
        // [V7-FIX] Reset ref guard on early return
        createSubmittingRef.current = false;
        setCreating(false);
        return;
      }
      // If balance check itself failed, log and continue (don't block)
      console.warn('Balance pre-check failed:', e);
    }

    try {
      safeSetStep({ type: 'compiling' });

      // [V9] Choose contract source based on pool type
      const contractFile = poolType === 'reward' ? '/contracts/RewardPool.aml' : '/contracts/SwapPool.aml';
      const sourceResp = await fetch(contractFile);
      const source = await sourceResp.text();

      const compileResult = await rpc.compileAml(source);
      const bytecode = compileResult.bytecode;

      safeSetStep({ type: 'computing_address' });

      const balance = await rpc.call<{ balance: string; nonce: number }>('octra_balance', [walletSnapshot]);
      // [SECURITY] F-6: Re-verify wallet hasn't changed
      if (walletService.address !== walletSnapshot) {
        throw new Error('Wallet changed during deploy — aborting');
      }
      const deployNonce = balance.nonce + 1;

      const addrResult = await rpc.computeContractAddress(bytecode, walletService.address, deployNonce);
      const poolAddress = addrResult.address;

      safeSetStep({ type: 'deploying' });

      let feeOu = '100000';
      try {
        const feeResp = await rpc.getRecommendedFee('deploy');
        feeOu = feeResp.recommended || '100000';
      } catch { /* fallback */ }

      const deployTxHash = await walletService.signAndSubmitDeployTx(rpc, {
        bytecode,
        poolAddress,
        feeOu,
      });

      await rpc.waitForReceipt(deployTxHash, 60);

      safeSetStep({ type: 'setting_tokens' });

      const tokenTxHash = await walletService.callContract({
        contract: poolAddress,
        method: 'set_tokens',
        params: [tokenA, tokenB],
        rpc,
      });

      await rpc.waitForReceipt(tokenTxHash, 60);

      // [V9] Reward pool: set reward config before fee
      if (poolType === 'reward' && rewardToken && rewardAmount && rewardMeta) {
        safeSetStep({ type: 'setting_reward' });

        const rawReward = parseUnits(rewardAmount, rewardMeta.decimals);
        const epochInfoForReward = await rpc.call<{ epoch_id: number }>('epoch_current');
        const currentEpoch = epochInfoForReward?.epoch_id || 0;
        const rewardStart = currentEpoch + 100; // start shortly after creation
        const rewardEnd = rewardStart + rewardDuration;

        const rewardConfigHash = await walletService.callContract({
          contract: poolAddress,
          method: 'set_reward_config',
          params: [rewardToken, rawReward, rewardStart, rewardEnd],
          rpc,
        });
        await rpc.waitForReceipt(rewardConfigHash, 60);
      }

      safeSetStep({ type: 'setting_fee' });

      const { num, denom } = getFeeParams();
      const feeTxHash = await walletService.callContract({
        contract: poolAddress,
        method: 'set_fee_params',
        params: [num, denom],
        rpc,
      });

      await rpc.waitForReceipt(feeTxHash, 60);

      safeSetStep({ type: 'registering' });

      // [V9] Register with appropriate factory method
      const regMethod = poolType === 'reward' ? 'register_reward_pool' : 'register_pool';
      const regParams = poolType === 'reward'
        ? [tokenA, tokenB, rewardToken, poolAddress]
        : [tokenA, tokenB, poolAddress];

      const regTxHash = await walletService.callContract({
        contract: factoryAddr,
        method: regMethod,
        params: regParams,
        rpc,
      });

      await rpc.waitForReceipt(regTxHash, 60);

      // [BUG-FIX] Call set_factory on the newly deployed pool
      try {
        const setFactoryHash = await walletService.callContract({
          contract: poolAddress,
          method: 'set_factory',
          params: [factoryAddr],
          rpc,
        });
        await rpc.waitForReceipt(setFactoryHash, 60);
      } catch (sfErr) {
        console.warn('[PoolPage] set_factory failed (non-fatal):', sfErr instanceof Error ? sfErr.message : String(sfErr));
      }

      // [V9] Grant reward token to pool (reward pool only)
      if (poolType === 'reward' && rewardToken && rewardAmount && rewardMeta) {
        safeSetStep({ type: 'granting_reward' });

        const rawReward = parseUnits(rewardAmount, rewardMeta.decimals);
        const grantRewardHash = await walletService.callContract({
          contract: rewardToken,
          method: 'grant',
          params: [poolAddress, rawReward],
          rpc,
        });
        await rpc.waitForReceipt(grantRewardHash, 60);
      }

      // [V7-SECURITY-FIX] Guard against null meta during initial liquidity
      const rawInitA = initAmountA && metaA ? parseUnits(initAmountA, metaA.decimals) : null;
      const rawInitB = initAmountB && metaB ? parseUnits(initAmountB, metaB.decimals) : null;

      // [V7-FIX] Validate that initial liquidity amounts are consistent:
      // - both empty = no initial liquidity (allowed)
      // - both positive = ok
      // - one set, one not = error (user forgot one)
      if ((initAmountA && !initAmountB) || (initAmountB && !initAmountA)) {
        throw new Error('Enter both amounts for initial liquidity, or leave both empty.');
      }

      if (rawInitA && rawInitB && BigInt(rawInitA) > 0 && BigInt(rawInitB) > 0) {
        safeSetStep({ type: 'granting_a' });

        const grantAHash = await walletService.callContract({
          contract: tokenA,
          method: 'grant',
          params: [poolAddress, rawInitA],
          rpc,
        });
        await rpc.waitForReceipt(grantAHash, 60);

        safeSetStep({ type: 'granting_b' });

        const grantBHash = await walletService.callContract({
          contract: tokenB,
          method: 'grant',
          params: [poolAddress, rawInitB],
          rpc,
        });
        await rpc.waitForReceipt(grantBHash, 60);

        safeSetStep({ type: 'adding_liquidity' });

        // [V7-FIX] Use chain epoch (not unix timestamp) for deadline
        const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
        const deadline = (epochInfo?.epoch_id || 0) + 300;
        // [BUG-FIX] Use minLp='1' for initial pool. The contract enforces its own
        // minimum_liquidity (burns 1000 LP). Using '1001' can cause 'min_lp not satisfied'
        // if sqrt(rawA * rawB) is between 1001 and 2001. Using '1' lets the contract
        // do its own minimum check and accept any valid initial liquidity.
        const addHash = await walletService.callContract({
          contract: poolAddress,
          method: 'add_liquidity',
          params: [rawInitA, rawInitB, '1', String(deadline), '0'],
          rpc,
        });
        await rpc.waitForReceipt(addHash, 60);
      }

      if (mountedRef.current) {
        // [V9] Include reward info in done state for reward pools
        const rewardInfo = poolType === 'reward' && rewardToken && rewardAmount && rewardMeta
          ? { rewardToken: rewardMeta.symbol, rewardAmount, duration: rewardDuration }
          : undefined;
        setStep({ type: 'done', poolAddress, rewardInfo });
        rpc.clearCache();
        onPoolCreated();
      }
    } catch (e) {
      if (mountedRef.current) {
        const errMsg = e instanceof Error ? e.message : 'Unknown error';
        // [V7-FIX] Check if failure is due to duplicate pool (race condition)
        if (errMsg.includes('pool already exists') && mountedRef.current) {
          try {
            const existing = await rpc.getPoolAddress(CONTRACTS.factory, tokenA, tokenB);
            safeSetStep({ type: 'error', message: `Pool already exists at ${existing}. Try a different pair.` });
          } catch {
            safeSetStep({ type: 'error', message: errMsg });
          }
        } else {
          safeSetStep({ type: 'error', message: errMsg });
        }
      }
    } finally {
      // [SECURITY] F-2: Reset ref guard
      createSubmittingRef.current = false;
      setCreating(false);
    }
  };

  const reset = () => {
    setStep({ type: 'idle' });
    setWizardStep(1);
    setTokenA('');
    setTokenB('');
    setMetaA(null);
    setMetaB(null);
    setFeeTier('0.30');
    setInitAmountA('');
    setInitAmountB('');
    // [V9] Reset reward pool state
    setPoolType('standard');
    setRewardToken('');
    setRewardMeta(null);
    setRewardAmount('');
    setRewardDuration(100800);
    setCreatorLockDays(7);
    setShowRewardSelect(false);
    setRewardBalance(null);
  };

  const isValidA = tokenA !== '' && metaA !== null;
  const isValidB = metaB !== null;

  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);

  const feeTiers = [
    { label: '0.01%', value: '0.01' as const },
    { label: '0.05%', value: '0.05' as const },
    { label: '0.30%', value: '0.30' as const },
    { label: '1.00%', value: '1.00' as const },
    { label: 'Custom', value: 'custom' as const },
  ];

  const DURATION_PRESETS = [
    { label: '1d', value: 14400 },
    { label: '7d', value: 100800 },
    { label: '30d', value: 432000 },
    { label: '90d', value: 1296000 },
    { label: '365d', value: 5256000 },
  ];

  const allStepDefs: { key: CreateStep['type']; label: string }[] = [
    { key: 'compiling', label: 'Compile contract' },
    { key: 'computing_address', label: 'Compute pool address' },
    { key: 'deploying', label: poolType === 'reward' ? 'Deploy RewardPool' : 'Deploy SwapPool' },
    { key: 'setting_tokens', label: 'Set pool tokens' },
    ...(poolType === 'reward' ? [{ key: 'setting_reward' as const, label: 'Set reward config' }] : []),
    { key: 'setting_fee', label: 'Set pool fee' },
    { key: 'registering', label: poolType === 'reward' ? 'Register reward pool' : 'Register pool' },
    ...(poolType === 'reward' ? [{ key: 'granting_reward' as const, label: 'Grant reward token' }] : []),
    { key: 'granting_a', label: `Grant ${metaA?.symbol ?? 'Token A'}` },
    { key: 'granting_b', label: `Grant ${metaB?.symbol ?? 'Token B'}` },
    { key: 'adding_liquidity', label: 'Add initial liquidity' },
  ];

  const hasInitLiquidity = !!(initAmountA && metaA && initAmountB && metaB
    && Number(initAmountA) > 0 && Number(initAmountB) > 0);

  function bigintSqrt(n: bigint): bigint {
    if (n < 2n) return n;
    let x = n, y = (x + 1n) / 2n;
    while (y < x) { x = y; y = (x + n / x) / 2n; }
    return x;
  }
  const sim = (() => {
    if (!hasInitLiquidity || !metaA || !metaB) return null;
    try {
      const rawA = BigInt(parseUnits(initAmountA, metaA.decimals));
      const rawB = BigInt(parseUnits(initAmountB, metaB.decimals));
      if (rawA <= 0n || rawB <= 0n) return null;
      const k = rawA * rawB;
      const lpGross = bigintSqrt(k);
      const MIN_LIQ = 1000n;
      const lpNet = lpGross > MIN_LIQ ? lpGross - MIN_LIQ : 0n;
      const priceAinB = Number(initAmountB) / Number(initAmountA);
      const priceBinA = Number(initAmountA) / Number(initAmountB);
      const sharePct = 100;
      return { rawA, rawB, k, lpGross, lpNet, priceAinB, priceBinA, sharePct };
    } catch { return null; }
  })();
  const stepDefs = hasInitLiquidity ? allStepDefs : allStepDefs.slice(0, 6);

  const stepType = step.type;
  const stepSnapshot = step;

  const step1Valid = isValidA && isValidB && hasValidPair;
  const step2Valid = poolType === 'standard' || (rewardToken && rewardAmount && Number(rewardAmount) > 0);

  return (
    <>
    <LoadingModal
      isOpen={step.type !== 'idle' && step.type !== 'error' && step.type !== 'done'}
      title="Creating Pool"
      steps={stepDefs}
      currentStep={step.type}
      error={step.type === 'error' ? step.message : undefined}
      onCancel={reset}
    />
    <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-5">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {([1, 2, 3] as const).map((s, idx) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
              wizardStep === s ? 'bg-[var(--app-blue)] text-white' :
              wizardStep > s ? 'bg-[var(--app-success)] text-white' :
              'bg-[var(--app-panel-soft)] text-[var(--app-muted)] border border-[var(--app-border)]'
            }`}>
              {wizardStep > s ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : s}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${
              wizardStep === s ? 'text-[var(--app-text)]' : 'text-[var(--app-muted)]'
            }`}>
              {s === 1 ? 'Tokens' : s === 2 ? 'Configure' : 'Liquidity'}
            </span>
            {idx < 2 && <div className={`flex-1 h-px mx-1 ${wizardStep > s ? 'bg-[var(--app-success)]' : 'bg-[var(--app-border)]'}`} />}
          </div>
        ))}
      </div>

      {step.type === 'idle' || step.type === 'error' ? (
        <>
          {/* ===== STEP 1: Select Tokens ===== */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {/* Token A */}
                <button
                  onClick={() => setShowTokenASelect(true)}
                  className={`bg-[var(--app-panel-soft)] rounded-xl p-4 border transition-colors text-left ${
                    isValidA ? 'border-[var(--app-blue)]/30' : 'border-[var(--app-border)] hover:border-[var(--app-blue)]/50'
                  }`}
                >
                  <div className="text-[10px] text-[var(--app-muted)] mb-2">Token A</div>
                  {metaA ? (
                    <>
                      <div className="text-lg font-bold">{metaA.symbol}</div>
                      <div className="text-[11px] text-[var(--app-muted)] truncate">{metaA.name}</div>
                      {walletAddress && (
                        <div className="text-[11px] text-[var(--app-muted-2)] mt-2 font-mono">
                          {balanceA === null ? '...' : formatUnits(balanceA, metaA.decimals)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-lg text-[var(--app-muted-2)]">Select</div>
                  )}
                </button>
                <TokenSelectModal
                  isOpen={showTokenASelect}
                  onClose={() => setShowTokenASelect(false)}
                  onSelect={handleSelectTokenA}
                  rpc={rpc}
                  excludeAddress={tokenB || undefined}
                />

                {/* Token B */}
                <button
                  onClick={() => setShowTokenBSelect(true)}
                  className={`bg-[var(--app-panel-soft)] rounded-xl p-4 border transition-colors text-left ${
                    isValidB ? 'border-[var(--app-blue)]/30' : 'border-[var(--app-border)] hover:border-[var(--app-blue)]/50'
                  }`}
                >
                  <div className="text-[10px] text-[var(--app-muted)] mb-2">Token B</div>
                  {metaB ? (
                    <>
                      <div className="text-lg font-bold">{metaB.symbol}</div>
                      <div className="text-[11px] text-[var(--app-muted)] truncate">{metaB.name}</div>
                      {walletAddress && (
                        <div className="text-[11px] text-[var(--app-muted-2)] mt-2 font-mono">
                          {balanceB === null ? '...' : formatUnits(balanceB, metaB.decimals)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-lg text-[var(--app-muted-2)]">Select</div>
                  )}
                </button>
                <TokenSelectModal
                  isOpen={showTokenBSelect}
                  onClose={() => setShowTokenBSelect(false)}
                  onSelect={handleSelectTokenB}
                  rpc={rpc}
                  excludeAddress={tokenA || undefined}
                />
              </div>

              {step.type === 'error' && (
                <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-3 py-2">
                  {step.message}
                </div>
              )}

              {isValidA && isValidB && !hasValidPair && (
                <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-3 py-2">
                  At least one token must already have a pair with WOCT
                </div>
              )}

              {pairAlreadyExists && (
                <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-3 py-2">
                  This pair already has a pool — create would fail
                </div>
              )}

              <button
                onClick={() => {
                  if (!isConnected) { connect(); return; }
                  setWizardStep(2);
                }}
                disabled={!step1Valid}
                className="w-full py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors"
              >
                {!isConnected ? 'Connect Wallet' : 'Continue'}
              </button>
            </div>
          )}

          {/* ===== STEP 2: Configure Pool ===== */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              {/* Fee Tier */}
              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
                <div className="text-xs text-[var(--app-muted)] mb-2">Fee Tier</div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {feeTiers.map(f => (
                    <button
                      key={f.value}
                      onClick={() => setFeeTier(f.value)}
                      className={`py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        feeTier === f.value
                          ? 'bg-[var(--app-blue)] text-white'
                          : 'bg-[var(--app-hover)] hover:bg-[var(--app-hover)] text-[var(--app-muted)]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                {feeTier === 'custom' && (
                  <div className="flex gap-2 mt-3">
                    <div className="flex-1">
                      <label className="text-[10px] text-[var(--app-muted-2)]">Numerator</label>
                      <input
                        type="number"
                        value={customNum}
                        onChange={e => setCustomNum(e.target.value)}
                        className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1"
                        min="1"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-[var(--app-muted-2)]">Denominator</label>
                      <input
                        type="number"
                        value={customDenom}
                        onChange={e => setCustomDenom(e.target.value)}
                        className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1"
                        min="1"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Pool Type */}
              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
                <div className="text-xs text-[var(--app-muted)] mb-2">Pool Type</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPoolType('standard')}
                    className={`py-3 rounded-xl text-sm font-medium transition-colors border-2 ${
                      poolType === 'standard'
                        ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10 text-[var(--app-blue)]'
                        : 'border-transparent bg-[var(--app-hover)] text-[var(--app-muted)]'
                    }`}
                  >
                    Standard AMM
                  </button>
                  <button
                    onClick={() => setPoolType('reward')}
                    className={`py-3 rounded-xl text-sm font-medium transition-colors border-2 ${
                      poolType === 'reward'
                        ? 'border-green-500 bg-green-500/10 text-green-400'
                        : 'border-transparent bg-[var(--app-hover)] text-[var(--app-muted)]'
                    }`}
                  >
                    Reward Pool
                  </button>
                </div>
              </div>

              {/* Reward Config */}
              {poolType === 'reward' && (
                <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-green-500/20 space-y-3">
                  <div className="text-xs text-green-400 font-medium">Reward Configuration</div>

                  <div>
                    <label className="text-[10px] text-[var(--app-muted-2)]">Reward Token (OCS01)</label>
                    <button
                      onClick={() => setShowRewardSelect(true)}
                      className={`w-full flex items-center justify-between bg-[var(--app-panel-soft)] text-sm font-medium outline-none rounded-lg px-3 py-2 border border-[var(--app-border)] hover:border-green-500/50 transition-colors mt-1 ${rewardToken ? '' : 'text-[var(--app-muted-2)]'}`}
                    >
                      <span>{rewardMeta ? rewardMeta.symbol : 'Select token'}</span>
                      <svg className="w-4 h-4 text-[var(--app-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {rewardMeta && rewardBalance && (
                      <div className="text-[10px] text-[var(--app-muted)] mt-1">
                        Balance: {formatUnits(rewardBalance, rewardMeta.decimals)} {rewardMeta.symbol}
                      </div>
                    )}
                    <TokenSelectModal
                      isOpen={showRewardSelect}
                      onClose={() => setShowRewardSelect(false)}
                      onSelect={handleSelectRewardToken}
                      rpc={rpc}
                      excludeAddress={tokenA || undefined}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-[var(--app-muted-2)]">Reward Amount</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={rewardAmount}
                      onChange={e => setRewardAmount(sanitizeNumericInput(e.target.value))}
                      placeholder="0.0"
                      className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-[var(--app-muted-2)]">Duration</label>
                    <div className="grid grid-cols-5 gap-1.5 mt-1">
                      {DURATION_PRESETS.map(d => (
                        <button
                          key={d.value}
                          onClick={() => setRewardDuration(d.value)}
                          className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                            rewardDuration === d.value
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                              : 'bg-[var(--app-hover)] text-[var(--app-muted)]'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] text-[var(--app-muted)] mt-1">
                      ~{Math.round(rewardDuration / 14400)} days
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-[var(--app-muted-2)]">Creator Lock (anti-rugpull)</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={creatorLockDays}
                        onChange={e => setCreatorLockDays(Math.max(7, parseInt(e.target.value) || 7))}
                        className="w-20 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-1.5 text-sm font-mono outline-none"
                        min="7"
                      />
                      <span className="text-xs text-[var(--app-muted)]">days min</span>
                    </div>
                  </div>

                  {rewardAmount && rewardMeta && (
                    <div className="bg-[var(--app-panel)] rounded-lg p-3 text-[10px] text-green-400/80 space-y-0.5">
                      <div>Distribution: linear over ~{Math.round(rewardDuration / 14400)} days</div>
                      <div>Creator LP locked {creatorLockDays}d | Reward immutable</div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setWizardStep(1)}
                  className="flex-1 py-3 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl font-medium text-sm hover:bg-[var(--app-hover)] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => setWizardStep(3)}
                  disabled={!step2Valid}
                  className="flex-[2] py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* ===== STEP 3: Initial Liquidity ===== */}
          {wizardStep === 3 && (
            <div className="space-y-4">
              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
                <div className="text-xs text-[var(--app-muted)] font-medium">Initial Liquidity (optional)</div>
                <div>
                  <label className="text-[10px] text-[var(--app-muted-2)]">{metaA?.symbol ?? 'Token A'}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={initAmountA}
                    onChange={e => setInitAmountA(sanitizeNumericInput(e.target.value))}
                    placeholder="0.0"
                    className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--app-muted-2)]">{metaB?.symbol ?? 'Token B'}</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={initAmountB}
                    onChange={e => setInitAmountB(sanitizeNumericInput(e.target.value))}
                    placeholder="0.0"
                    className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1"
                  />
                </div>
              </div>

              {/* Price simulation */}
              {sim && (
                <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-2 text-xs">
                  <div className="text-[10px] text-[var(--app-muted)] font-medium">Pool Preview</div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">Price</span>
                    <span className="font-mono">1 {metaA?.symbol} = {sim.priceAinB.toLocaleString(undefined, { maximumFractionDigits: 6 })} {metaB?.symbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">LP minted</span>
                    <span className="font-mono">{formatUnits(sim.lpNet.toString(), 6)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">Your share</span>
                    <span className="font-mono">{sim.sharePct.toFixed(0)}%</span>
                  </div>
                </div>
              )}

              {!initAmountA && !initAmountB && (
                <div className="text-xs text-[var(--app-muted)] bg-[var(--app-panel-soft)] rounded-lg px-3 py-2 text-center">
                  Skip liquidity to create an empty pool
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setWizardStep(2)}
                  className="flex-1 py-3 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl font-medium text-sm hover:bg-[var(--app-hover)] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleCreatePool}
                  disabled={creating}
                  className="flex-[2] py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors"
                >
                  {creating ? 'Creating...' : initAmountA && initAmountB ? 'Create Pool + Add Liquidity' : 'Create Pool'}
                </button>
              </div>
            </div>
          )}
        </>
      ) : stepType === 'done' ? (
        <div className="bg-[var(--app-panel-soft)] rounded-xl p-6 border border-[var(--app-border)] space-y-4">
          <div className="flex items-center gap-2 text-[var(--app-success)]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm font-semibold">Pool Created</span>
          </div>
          <div className="text-xs text-[var(--app-muted)] break-all font-mono bg-[var(--app-panel)] rounded-lg px-3 py-2">
            Pool: {'poolAddress' in stepSnapshot ? stepSnapshot.poolAddress : ''}
          </div>
          {'rewardInfo' in stepSnapshot && stepSnapshot.rewardInfo && (
            <div className="text-xs bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 space-y-1">
              <div className="text-green-400 font-medium">Reward Pool Created</div>
              <div className="text-[var(--app-muted)]">
                Reward: {stepSnapshot.rewardInfo.rewardAmount} {stepSnapshot.rewardInfo.rewardToken}
              </div>
              <div className="text-[var(--app-muted)]">
                Duration: {stepSnapshot.rewardInfo.duration} epochs (~{Math.round(stepSnapshot.rewardInfo.duration / 14400)} days)
              </div>
              <div className="text-green-400/80 text-[10px]">
                LP tokens locked 7 days | Reward immutable | Linear distribution
              </div>
            </div>
          )}
          <button
            onClick={() => navigate(`/liquidity?pool=${'poolAddress' in stepSnapshot ? stepSnapshot.poolAddress : ''}`)}
            className="w-full py-2 bg-green-600 hover:bg-green-700 rounded-xl text-sm font-medium transition-colors"
          >
            Add / Manage Liquidity
          </button>
          <button
            onClick={reset}
            className="w-full py-2 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] rounded-xl text-sm font-medium hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] transition-colors"
          >
            Create Another Pool
          </button>
        </div>
      ) : null}
    </div>
    </>
  );
}

function PoolPage() {
  const { rpc, isConnected, connect, walletAddress } = useApp();
  const navigate = useNavigate();
  const { getTokenUsd, octPrice } = usePriceService(rpc);
  const [pools, setPools] = useState<PoolDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [poolPrices, setPoolPrices] = useState<Record<string, { priceA: number; priceB: number; tvlUsd: number }>>({});

  const mountedRef = useRef(true);

  const loadPools = useCallback(async () => {
    setLoading(true);
    try {
      const poolAddrs = await rpc.getAllPools(CONTRACTS.factory);
      // Include config pool if not already in factory list
      if (CONTRACTS.pool && !poolAddrs.includes(CONTRACTS.pool)) {
        poolAddrs.push(CONTRACTS.pool);
      }

      // [V9] Fetch reward pools list
      let rewardPoolAddrs: string[] = [];
      try {
        rewardPoolAddrs = await rpc.getRewardPools(CONTRACTS.factory);
      } catch { /* noop */ }

      const displays: PoolDisplay[] = [];
      for (const addr of poolAddrs) {
        try {
          const info = await rpc.getPoolInfo(addr);
          if (!info.tokenA || !info.tokenB) continue;
          // [V7-PASS10] LOW-35: parallelize meta + fee fetch
          const [metaA, metaB, feeParams] = await Promise.all([
            rpc.getTokenMeta(info.tokenA),
            rpc.getTokenMeta(info.tokenB),
            rpc.getPoolFeeParams(addr),
          ]);
          if (!metaA.symbol || metaA.symbol === '???') continue;
          if (!metaB.symbol || metaB.symbol === '???') continue;
          let rewardsPerEpoch = 0;
          try {
            // [V7-FIX] Validate oesAddr is actually an OES contract (has get_rewards_info).
            // Don't fallback to tokenB which could be WOCT or any other token.
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

          // [V9] Check if this is a reward pool and fetch reward info
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

  // [V7-SECURITY-FIX] Use BigInt to avoid precision loss on large LP values
  const totalLPAll = pools.reduce((sum, p) => {
    try { return sum + BigInt(p.totalLP); } catch { return sum; }
  }, 0n);

  return (
    <div className="page-surface mx-auto w-full max-w-5xl pt-1 sm:pt-3 space-y-5">
      <div className="page-heading">
        <div><div className="page-kicker">EverestSwap markets</div><h1 className="page-title">Pools</h1><p className="page-subtitle">Explore available liquidity and route your next trade.</p></div>
        <button onClick={() => setShowCreate(!showCreate)} className="page-action">{showCreate ? 'Close builder' : 'Create pool'}</button>
      </div>

      {showCreate && (
        <CreatePoolForm
          rpc={rpc}
          isConnected={isConnected}
          onPoolCreated={loadPools}
          connect={connect}
          walletAddress={walletAddress}
        />
      )}

      <div className="page-panel overflow-hidden">
        <div className="page-panel-header"><div><h2 className="page-panel-title">Active pools</h2><p className="page-panel-copy">Live reserves, fee tiers, and locked liquidity.</p></div><span className="swap-live-label"><span className="status-dot" />{pools.length} tracked</span></div>
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
                  onClick={() => navigate(`/liquidity?pool=${p.address}`)}
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
                          {/* [V9] Reward pool badge */}
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
                    {/* [V9] Reward pool info */}
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
          <div className="font-medium mt-0.5">{Object.values(poolPrices).reduce((s, v) => s + v.tvlUsd, 0) > 0 ? `~$${Object.values(poolPrices).reduce((s, v) => s + v.tvlUsd, 0).toFixed(2)}` : '...'}</div>
        </div>
      </div>
      </div>
    </div>
  );
}

export default PoolPage;
