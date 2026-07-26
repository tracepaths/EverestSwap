import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OctraRpc } from '../services/octraRpc';
import { CONTRACTS, WOCT_TOKEN } from '../types';
import { formatUnits, parseUnits, sanitizeNumericInput, parseRawBalance } from '../services/swapService';
import { walletService } from '../services/walletService';
import TokenSelectModal from './TokenSelectModal';
import LoadingModal from './LoadingModal';

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
             <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
               wizardStep === s ? 'bg-[var(--app-blue)] text-white shadow-lg shadow-[var(--app-blue)]/30' :
               wizardStep > s ? 'bg-[var(--app-success)] text-white' :
               'bg-[var(--app-panel-soft)] text-[var(--app-muted)] border border-[var(--app-border)]'
             }`}>
               {wizardStep > s ? (
                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                   <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                 </svg>
               ) : s}
             </div>
             <span className={`text-xs font-medium ${
               wizardStep === s ? 'text-[var(--app-text)]' : 'text-[var(--app-muted)]'
             }`}>
               {s === 1 ? 'Tokens' : s === 2 ? 'Configure' : 'Liquidity'}
             </span>
             {idx < 2 && <div className={`flex-1 h-px mx-1 ${wizardStep > s ? 'bg-[var(--app-success)]' : 'bg-[var(--app-border)]'}`} />}
           </div>
         ))}
       </div>

       {/* Step summary */}
       {(wizardStep === 2 || wizardStep === 3) && (metaA || metaB) && (
         <div className="flex flex-wrap items-center gap-2 text-[10px]">
           <span className="bg-[var(--app-panel-soft)] rounded-full px-2 py-0.5 font-mono">
             {metaA ? metaA.symbol : '?'} / {metaB ? metaB.symbol : '?'}
           </span>
           <span className="bg-[var(--app-panel-soft)] rounded-full px-2 py-0.5">
             {feeTier === 'custom' ? `${customNum}/${customDenom}` : `${feeTier}%`}
           </span>
           {poolType === 'reward' && (
             <span className="bg-green-500/10 text-green-400 rounded-full px-2 py-0.5 border border-green-500/20">Reward</span>
           )}
           {hasInitLiquidity && (
             <span className="bg-[var(--app-panel-soft)] rounded-full px-2 py-0.5">w/ Liquidity</span>
           )}
         </div>
       )}

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
                     isValidA ? 'border-[var(--app-blue)]/40 shadow-sm shadow-[var(--app-blue)]/10' : 'border-[var(--app-border)] hover:border-[var(--app-blue)]/50'
                   }`}
                 >
                   <div className="flex items-center gap-3">
                     {metaA ? (
                       <div className="w-9 h-9 rounded-full bg-[var(--app-blue)] flex items-center justify-center text-sm font-bold text-white shrink-0">
                         {metaA.symbol[0]}
                       </div>
                     ) : (
                       <div className="w-9 h-9 rounded-full bg-[var(--app-hover)] flex items-center justify-center text-sm font-bold text-[var(--app-muted-2)] shrink-0">
                         ?
                       </div>
                     )}
                     <div className="flex-1 min-w-0">
                       <div className="text-[10px] text-[var(--app-muted)] mb-1">Token A</div>
                       {metaA ? (
                         <>
                           <div className="text-base font-bold truncate">{metaA.symbol}</div>
                           <div className="text-[11px] text-[var(--app-muted)] truncate">{metaA.name}</div>
                           {walletAddress && (
                             <div className="text-[11px] text-[var(--app-muted-2)] mt-1 font-mono">
                               {balanceA === null ? '...' : formatUnits(balanceA, metaA.decimals)}
                             </div>
                           )}
                         </>
                       ) : (
                         <div className="text-sm text-[var(--app-muted-2)]">Select token</div>
                       )}
                     </div>
                   </div>
                 </button>
                 <TokenSelectModal
                   isOpen={showTokenASelect}
                   onClose={() => setShowTokenASelect(false)}
                   onSelect={handleSelectTokenA}
                   rpc={rpc}
                   excludeAddress={tokenB || undefined}
                   walletAddress={walletAddress}
                   isConnected={isConnected}
                 />

                 {/* Token B */}
                 <button
                   onClick={() => setShowTokenBSelect(true)}
                   className={`bg-[var(--app-panel-soft)] rounded-xl p-4 border transition-colors text-left ${
                     isValidB ? 'border-[var(--app-blue)]/40 shadow-sm shadow-[var(--app-blue)]/10' : 'border-[var(--app-border)] hover:border-[var(--app-blue)]/50'
                   }`}
                 >
                   <div className="flex items-center gap-3">
                     {metaB ? (
                       <div className="w-9 h-9 rounded-full bg-[var(--app-blue-2)] flex items-center justify-center text-sm font-bold text-white shrink-0">
                         {metaB.symbol[0]}
                       </div>
                     ) : (
                       <div className="w-9 h-9 rounded-full bg-[var(--app-hover)] flex items-center justify-center text-sm font-bold text-[var(--app-muted-2)] shrink-0">
                         ?
                       </div>
                     )}
                     <div className="flex-1 min-w-0">
                       <div className="text-[10px] text-[var(--app-muted)] mb-1">Token B</div>
                       {metaB ? (
                         <>
                           <div className="text-base font-bold truncate">{metaB.symbol}</div>
                           <div className="text-[11px] text-[var(--app-muted)] truncate">{metaB.name}</div>
                           {walletAddress && (
                             <div className="text-[11px] text-[var(--app-muted-2)] mt-1 font-mono">
                               {balanceB === null ? '...' : formatUnits(balanceB, metaB.decimals)}
                             </div>
                           )}
                         </>
                       ) : (
                         <div className="text-sm text-[var(--app-muted-2)]">Select token</div>
                       )}
                     </div>
                   </div>
                 </button>
                 <TokenSelectModal
                   isOpen={showTokenBSelect}
                   onClose={() => setShowTokenBSelect(false)}
                   onSelect={handleSelectTokenB}
                   rpc={rpc}
                   excludeAddress={tokenA || undefined}
                   walletAddress={walletAddress}
                   isConnected={isConnected}
                 />
               </div>

               {step.type === 'error' && (
                 <div className="text-sm text-[var(--app-danger)] bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-start gap-2">
                   <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                     <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                   </svg>
                   <span>{step.message}</span>
                 </div>
               )}

               {isValidA && isValidB && !hasValidPair && (
                 <div className="text-sm text-[var(--app-danger)] bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-start gap-2">
                   <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                     <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                   </svg>
                   <span>At least one token must already have a pair with WOCT</span>
                 </div>
               )}

               {pairAlreadyExists && (
                 <div className="text-sm text-[var(--app-danger)] bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-start gap-2">
                   <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                     <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                   </svg>
                   <span>This pair already has a pool — create would fail</span>
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
                  <div className="flex flex-col gap-2 mt-3">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] text-[var(--app-muted-2)]">Numerator</label>
                        <input
                          type="number"
                          value={customNum}
                          onChange={e => setCustomNum(e.target.value)}
                          className={`w-full bg-[var(--app-panel-soft)] border rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1 ${(() => { const n = parseInt(customNum, 10) || 0; const d = parseInt(customDenom, 10) || 1; return n <= 0 || d <= 0 || n >= d ? 'border-red-500/50' : 'border-[var(--app-border)]'; })()}`}
                          min="1"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-[var(--app-muted-2)]">Denominator</label>
                        <input
                          type="number"
                          value={customDenom}
                          onChange={e => setCustomDenom(e.target.value)}
                          className={`w-full bg-[var(--app-panel-soft)] border rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1 ${(() => { const n = parseInt(customNum, 10) || 0; const d = parseInt(customDenom, 10) || 1; return n <= 0 || d <= 0 || n >= d ? 'border-red-500/50' : 'border-[var(--app-border)]'; })()}`}
                          min="1"
                        />
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--app-muted)]">
                      {(() => {
                        const n = parseInt(customNum, 10) || 0;
                        const d = parseInt(customDenom, 10) || 1;
                        if (n <= 0 || d <= 0) return 'Enter valid values';
                        if (n >= d) return 'Numerator must be less than denominator';
                        const pct = (n / d) * 100;
                        if (n * 10000 < d * 3) return `${pct.toFixed(2)}% — fee too low (min 0.03%)`;
                        if (n * 1000 > d * 10) return `${pct.toFixed(2)}% — fee too high (max 1%)`;
                        return `${pct.toFixed(2)}% — valid`;
                      })()}
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
                      walletAddress={walletAddress}
                      isConnected={isConnected}
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
                 <div className="text-sm text-[var(--app-muted)] bg-[var(--app-panel-soft)] rounded-lg px-3 py-2 text-center">
                   Skip liquidity to create an empty pool
                 </div>
               )}

               {/* Review summary */}
               <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-2 text-sm">
                 <div className="text-[10px] text-[var(--app-muted)] font-medium mb-2">Review</div>
                 <div className="flex justify-between">
                   <span className="text-[var(--app-muted)]">Pair</span>
                   <span className="font-mono font-medium">{metaA?.symbol ?? '?'} / {metaB?.symbol ?? '?'}</span>
                 </div>
                 <div className="flex justify-between">
                   <span className="text-[var(--app-muted)]">Fee Tier</span>
                   <span className="font-mono font-medium">{feeTier === 'custom' ? `${customNum}/${customDenom}` : `${feeTier}%`}</span>
                 </div>
                 <div className="flex justify-between">
                   <span className="text-[var(--app-muted)]">Type</span>
                   <span className="font-mono font-medium">{poolType === 'reward' ? 'Reward Pool' : 'Standard AMM'}</span>
                 </div>
                 {hasInitLiquidity && (
                   <div className="flex justify-between">
                     <span className="text-[var(--app-muted)]">Liquidity</span>
                     <span className="font-mono font-medium">{initAmountA} {metaA?.symbol} + {initAmountB} {metaB?.symbol}</span>
                   </div>
                 )}
                 {poolType === 'reward' && rewardMeta && rewardAmount && (
                   <div className="flex justify-between">
                     <span className="text-[var(--app-muted)]">Reward</span>
                     <span className="font-mono font-medium text-green-400">{rewardAmount} {rewardMeta.symbol}</span>
                   </div>
                 )}
               </div>

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
           <div className="flex items-center gap-3">
             <div className="w-12 h-12 rounded-full bg-[var(--app-success)] flex items-center justify-center animate-bounce">
               <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                 <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
               </svg>
             </div>
             <div>
               <div className="text-base font-semibold text-[var(--app-success)]">Pool Created</div>
               <div className="text-xs text-[var(--app-muted)]">Your pool is now live</div>
             </div>
           </div>
           <div className="text-sm text-[var(--app-muted)] break-all font-mono bg-[var(--app-panel)] rounded-lg px-3 py-2">
             Pool: {'poolAddress' in stepSnapshot ? stepSnapshot.poolAddress : ''}
           </div>
           {'rewardInfo' in stepSnapshot && stepSnapshot.rewardInfo && (
             <div className="text-sm bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 space-y-1.5">
               <div className="text-green-400 font-semibold">Reward Pool Created</div>
               <div className="text-[var(--app-muted)]">
                 Reward: {stepSnapshot.rewardInfo.rewardAmount} {stepSnapshot.rewardInfo.rewardToken}
               </div>
               <div className="text-[var(--app-muted)]">
                 Duration: {stepSnapshot.rewardInfo.duration} epochs (~{Math.round(stepSnapshot.rewardInfo.duration / 14400)} days)
               </div>
               <div className="text-green-400/80 text-xs">
                 LP tokens locked 7d | Reward immutable | Linear distribution
               </div>
             </div>
           )}
           <button
             onClick={() => navigate(`/liquidity?pool=${'poolAddress' in stepSnapshot ? stepSnapshot.poolAddress : ''}`)}
             className="w-full py-2.5 bg-green-600 hover:bg-green-700 rounded-xl text-sm font-medium transition-colors"
           >
             Add / Manage Liquidity
           </button>
           <button
             onClick={reset}
             className="w-full py-2.5 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] rounded-xl text-sm font-medium hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] transition-colors"
           >
             Create Another Pool
           </button>
        </div>
      ) : null}
    </div>
    </>
  );
}

export default CreatePoolForm;
