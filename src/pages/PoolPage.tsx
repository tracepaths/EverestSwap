import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import type { OctraRpc } from '../services/octraRpc';
import { CONTRACTS, WOCT_TOKEN } from '../types';
import { formatUnits, parseUnits, sanitizeNumericInput, parseRawBalance } from '../services/swapService';
import { walletService } from '../services/walletService';
import TokenTrustBadge from '../components/TokenTrustBadge';
import TokenSelectModal from '../components/TokenSelectModal';
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
  | { type: 'setting_fee' }
  | { type: 'registering' }
  | { type: 'granting_a' }
  | { type: 'granting_b' }
  | { type: 'adding_liquidity' }
  | { type: 'done'; poolAddress: string }
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
  const [trustedA, setTrustedA] = useState(false);
  const [trustedB, setTrustedB] = useState(false);
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
    rpc.isTrustedToken(CONTRACTS.factory, address).then(t => { if (mountedRef.current) setTrustedA(t); });
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
    rpc.isTrustedToken(CONTRACTS.factory, address).then(t => { if (mountedRef.current) setTrustedB(t); });
    // Fetch balance
    if (walletAddress) {
      if (address === '') {
        rpc.getBalance(walletAddress).then(bal => { if (mountedRef.current) setBalanceB(parseRawBalance(bal.balance_raw, 6)); }).catch(() => { if (mountedRef.current) setBalanceB(null); });
      } else {
        rpc.getTokenBalance(address, walletAddress).then(bal => { if (mountedRef.current) setBalanceB(bal); }).catch(() => { if (mountedRef.current) setBalanceB(null); });
      }
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

      const sourceResp = await fetch('/contracts/SwapPool.aml');
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

      const regTxHash = await walletService.callContract({
        contract: factoryAddr,
        method: 'register_pool',
        params: [tokenA, tokenB, poolAddress],
        rpc,
      });

      await rpc.waitForReceipt(regTxHash, 60);

      // [BUG-FIX] Call set_factory on the newly deployed pool so that
      // validate_initial_price (called during add_liquidity) uses the real factory
      // address instead of `origin` (the constructor's placeholder).
      // Without this, the equilibrium price guard call goes to origin and fails silently,
      // or could route to an unexpected contract in edge cases.
      try {
        const setFactoryHash = await walletService.callContract({
          contract: poolAddress,
          method: 'set_factory',
          params: [factoryAddr],
          rpc,
        });
        await rpc.waitForReceipt(setFactoryHash, 60);
      } catch (sfErr) {
        // set_factory is a best-effort step — if it fails (e.g. already set),
        // log and continue. Pool creation can still succeed.
        console.warn('[PoolPage] set_factory failed (non-fatal):', sfErr instanceof Error ? sfErr.message : String(sfErr));
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
        setStep({ type: 'done', poolAddress });
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
    setTokenA('');
    setTokenB('');
    setMetaA(null);
    setMetaB(null);
    setTrustedA(false);
    setTrustedB(false);
    setFeeTier('0.30');
    setInitAmountA('');
    setInitAmountB('');
  };

  const allStepDefs: { key: CreateStep['type']; label: string }[] = [
    { key: 'compiling', label: 'Compile contract' },
    { key: 'computing_address', label: 'Compute pool address' },
    { key: 'deploying', label: 'Deploy SwapPool' },
    { key: 'setting_tokens', label: 'Set pool tokens' },
    { key: 'setting_fee', label: 'Set pool fee' },
    { key: 'registering', label: 'Register pool' },
    { key: 'granting_a', label: `Grant ${metaA?.symbol ?? 'Token A'}` },
    { key: 'granting_b', label: `Grant ${metaB?.symbol ?? 'Token B'}` },
    { key: 'adding_liquidity', label: 'Add initial liquidity' },
  ];

  const hasInitLiquidity = !!(initAmountA && metaA && initAmountB && metaB
    && Number(initAmountA) > 0 && Number(initAmountB) > 0);

  // [SIM] Pool price simulation — computed live from initial liquidity inputs.
  // Uses BigInt for LP/K precision (matches contract sqrt geometric-mean math).
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
      const sharePct = 100; // first LP owns 100% after burn
      return { rawA, rawB, k, lpGross, lpNet, priceAinB, priceBinA, sharePct };
    } catch { return null; }
  })();
  const stepDefs = hasInitLiquidity ? allStepDefs : allStepDefs.slice(0, 6);
  const totalSteps = stepDefs.length;

  const getStepIndex = (stepType: CreateStep['type']): number => {
    return stepDefs.findIndex(s => s.key === stepType);
  };

  const stepType = step.type;
  const stepSnapshot = step;

  const feeTiers = [
    { label: '0.01%', value: '0.01' as const },
    { label: '0.05%', value: '0.05' as const },
    { label: '0.30%', value: '0.30' as const },
    { label: '1.00%', value: '1.00' as const },
    { label: 'Custom', value: 'custom' as const },
  ];

  const isValidA = tokenA !== '' && metaA !== null;
  const isValidB = metaB !== null;

  return (
    <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-4">
      <h3 className="text-sm font-semibold">Create New Pool</h3>

      {step.type === 'idle' || step.type === 'error' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-2">
              <label className="text-xs text-[var(--app-muted)]">Token A</label>
              <button
                onClick={() => setShowTokenASelect(true)}
                className={`w-full flex items-center justify-between bg-[var(--app-panel-soft)] text-base font-medium outline-none rounded-lg px-3 py-2 border border-[var(--app-border)] hover:border-[#3B82F6] transition-colors ${tokenA ? '' : 'text-[var(--app-muted-2)]'}`}
              >
                <span>{tokenA && metaA ? metaA.symbol : 'Select token'}</span>
                <svg className="w-4 h-4 text-[var(--app-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isValidA && metaA && (
                <div className="text-xs space-y-0.5 mt-2">
                  <div className="font-medium text-[var(--app-blue-3)]">{metaA.symbol}</div>
                  <div className="text-[var(--app-muted)] truncate">{metaA.name}</div>
                  <div className="text-[var(--app-muted)]">Decimals: {metaA.decimals}</div>
                  <TokenTrustBadge rating={trustedA ? 5 : 1} />
                  {walletAddress && (
                    <div className="text-[10px] text-[var(--app-muted)]">
                      Balance: {balanceA === null ? '...' : formatUnits(balanceA, metaA.decimals)}
                    </div>
                  )}
                </div>
              )}
              <TokenSelectModal
                isOpen={showTokenASelect}
                onClose={() => setShowTokenASelect(false)}
                onSelect={handleSelectTokenA}
                rpc={rpc}
                excludeAddress={tokenB || undefined}
              />
            </div>
            <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-2">
              <label className="text-xs text-[var(--app-muted)]">Token B</label>
              <button
                onClick={() => setShowTokenBSelect(true)}
                className={`w-full flex items-center justify-between bg-[var(--app-panel-soft)] text-base font-medium outline-none rounded-lg px-3 py-2 border border-[var(--app-border)] hover:border-[#3B82F6] transition-colors ${tokenB ? '' : 'text-[var(--app-muted-2)]'}`}
              >
                <span>{tokenB && metaB ? metaB.symbol : 'Select token'}</span>
                <svg className="w-4 h-4 text-[var(--app-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isValidB && metaB && (
                <div className="text-xs space-y-0.5 mt-2">
                  <div className="font-medium text-[var(--app-blue-3)]">{metaB.symbol}</div>
                  <div className="text-[var(--app-muted)] truncate">{metaB.name}</div>
                  <div className="text-[var(--app-muted)]">Decimals: {metaB.decimals}</div>
                  <TokenTrustBadge rating={trustedB ? 5 : 1} />
                  {walletAddress && (
                    <div className="text-[10px] text-[var(--app-muted)]">
                      Balance: {balanceB === null ? '...' : formatUnits(balanceB, metaB.decimals)}
                    </div>
                  )}
                </div>
              )}
              <TokenSelectModal
                isOpen={showTokenBSelect}
                onClose={() => setShowTokenBSelect(false)}
                onSelect={handleSelectTokenB}
                rpc={rpc}
                excludeAddress={tokenA || undefined}
              />
            </div>
          </div>

          <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
            <div className="text-xs text-[var(--app-muted)] mb-2">Fee Tier</div>
            <div className="flex gap-2">
              {feeTiers.map(f => (
                <button
                  key={f.value}
                  onClick={() => setFeeTier(f.value)}
                  className={`flex-1 py-2 rounded-lg text-base font-medium transition-colors ${
                    feeTier === f.value
                      ? 'bg-[var(--app-blue)] text-[var(--app-text)]'
                      : 'bg-[var(--app-hover)] hover:bg-[var(--app-hover)]'
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
                    className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-1.5 text-base font-mono outline-none mt-1"
                    min="1"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-[var(--app-muted-2)]">Denominator</label>
                  <input
                    type="number"
                    value={customDenom}
                    onChange={e => setCustomDenom(e.target.value)}
                    className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-1.5 text-base font-mono outline-none mt-1"
                    min="1"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
              <div className="text-xs text-[var(--app-muted)] font-medium">Initial Liquidity (optional)</div>
              <div>
                <label className="text-[10px] text-[var(--app-muted-2)]">{metaA?.symbol ?? 'Token A'} Amount</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={initAmountA}
                  // [SECURITY] F-1: Sanitize input
                  onChange={e => setInitAmountA(sanitizeNumericInput(e.target.value))}
                  placeholder="0.0"
                  className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-1.5 text-sm font-mono outline-none mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--app-muted-2)]">{metaB?.symbol ?? 'Token B'} Amount</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={initAmountB}
                  // [SECURITY] F-1: Sanitize input
                  onChange={e => setInitAmountB(sanitizeNumericInput(e.target.value))}
                  placeholder="0.0"
                  className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-1.5 text-sm font-mono outline-none mt-1"
                />
              </div>
            </div>

            <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
              <div className="text-xs text-[var(--app-muted)] font-medium">Price Simulation</div>
              {sim ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--app-muted-2)]">Price 1 {metaA?.symbol}</span>
                    <span className="font-mono">{sim.priceAinB.toLocaleString(undefined, { maximumFractionDigits: 12 })} {metaB?.symbol}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--app-muted-2)]">Price 1 {metaB?.symbol}</span>
                    <span className="font-mono">{sim.priceBinA.toLocaleString(undefined, { maximumFractionDigits: 12 })} {metaA?.symbol}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--app-muted-2)]">LP minted</span>
                    <span className="font-mono">{formatUnits(sim.lpNet.toString(), 6)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--app-muted-2)]">K invariant</span>
                    <span className="font-mono truncate text-right">{sim.k.toString()}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--app-muted-2)]">Pool share</span>
                    <span className="font-mono">{sim.sharePct.toFixed(0)}%</span>
                  </div>
                  <div className="text-[11px] text-[var(--app-muted)] pt-1 border-t border-[var(--app-border)]">
                    Harga awal dihitung dari rasio Token A dan Token B. Saat salah satu nilai berubah, simulasi ini ikut berubah.
                  </div>
                </div>
              ) : (
                <div className="text-xs text-[var(--app-muted)] leading-relaxed">
                  Masukkan jumlah Token A dan Token B untuk melihat harga awal, LP minted, dan invariant pool secara langsung.
                </div>
              )}
            </div>
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

          <button
            onClick={() => {
              // [V7-FIX] If not connected, actually call connect() instead of
              // silently triggering handleCreatePool (which would fail)
              if (!isConnected) { connect(); return; }
              handleCreatePool();
            }}
            // [V7-FIX] Disable when pair already exists — would revert at register_pool
            disabled={!isConnected ? false : (!isValidA || !isValidB || !hasValidPair || creating || pairAlreadyExists)}
            className="w-full py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors"
            title={pairAlreadyExists ? 'This pair already has a pool — create would fail' : undefined}
          >
            {!isConnected ? 'Connect Wallet' : isValidA && isValidB && hasValidPair && initAmountA && initAmountB ? 'Create Pool + Add Liquidity' : 'Create Pool'}
          </button>
        </>
      ) : ((stepType === 'idle' || stepType === 'error') ? null : (
        <div className="bg-[var(--app-panel-soft)] rounded-xl p-6 border border-[var(--app-border)] space-y-4">
          {/* Header with step counter */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--app-text)]">
              {stepType === 'done' ? 'Pool Created' : 'Creating Pool'}
            </span>
            {stepType !== 'done' && (
              <span className="text-xs font-mono text-[var(--app-muted)]">
                Step {getStepIndex(stepType) + 1}/{totalSteps}
              </span>
            )}
          </div>

          {/* Progress bar */}
          {stepType !== 'done' && (
            <div className="h-1.5 bg-[var(--app-panel)] rounded-full overflow-hidden border border-[var(--app-border)]">
              <div
                className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)]"
                style={{ width: `${((getStepIndex(stepType) + 1) / totalSteps) * 100}%` }}
              />
            </div>
          )}

          {/* Step checklist */}
          <div className="space-y-1.5">
            {stepDefs.map((def, idx) => {
              const currentIdx = stepType === 'done' ? totalSteps : getStepIndex(stepType);
              const isDone = idx < currentIdx;
              const isCurrent = stepType !== 'done' && idx === currentIdx;

              return (
                <div
                  key={def.key}
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                    isCurrent ? 'bg-[var(--app-blue)]/10 text-[var(--app-blue-3)]' :
                    isDone ? 'text-[var(--app-success)]' :
                    'text-[var(--app-muted)]'
                  }`}
                >
                  {isDone ? (
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isCurrent ? (
                    <div className="w-4 h-4 flex-shrink-0 border-2 border-[var(--app-blue)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <div className="w-4 h-4 flex-shrink-0 rounded-full border border-[var(--app-border)]" />
                  )}
                  <span className="font-medium">
                    {idx + 1}. {def.label}
                  </span>
                  {isCurrent && (
                    <span className="ml-auto text-[10px] text-[var(--app-muted)]">sign...</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Done state */}
          {stepType === 'done' && (
            <div className="space-y-3">
              <div className="text-xs text-[var(--app-muted)] break-all font-mono bg-[var(--app-panel-soft)] rounded-lg px-3 py-2">
                Pool: {'poolAddress' in stepSnapshot ? stepSnapshot.poolAddress : ''}
              </div>
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
          )}
        </div>
      ))}
    </div>
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
                        <div className="font-medium">{p.symbolA}/{p.symbolB}</div>
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
