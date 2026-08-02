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
  | { type: 'pre_approving' }
  | { type: 'creating' }
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
  const [creating, setCreating] = useState(false);

  const mountedRef = useRef(true);
  const createSubmittingRef = useRef(false);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  useEffect(() => {
    if (!tokenA || !tokenB) { setHasValidPair(false); return; }
    if (tokenA === WOCT_TOKEN.address || tokenB === WOCT_TOKEN.address) { setHasValidPair(true); return; }
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

  const handleSelectTokenA = (address: string, meta: TokenMeta) => {
    if (address === tokenB) return;
    setTokenA(address);
    setMetaA(meta);
    setInitAmountA('');
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
      if (num <= 0 || denom <= 0 || num >= denom) throw new Error('Invalid fee: numerator must be > 0 and < denominator');
      if (num * 10000 < denom * 3) throw new Error('Fee too low (min 0.03%, e.g. 3/10000)');
      if (num * 1000 > denom * 10) throw new Error('Fee too high (max 1%, e.g. 10/1000)');
      return { num, denom };
    }
    return { num: 3, denom: 1000 };
  };

  const handleCreatePool = async () => {
    if (!tokenA || !tokenB) return;
    if (creating) return;
    if (createSubmittingRef.current) return;
    createSubmittingRef.current = true;
    setCreating(true);
    const safeSetStep = (s: typeof step) => {
      if (mountedRef.current) setStep(s);
    };

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
          createSubmittingRef.current = false; setCreating(false); return;
        }
        if (statusA.blacklisted) {
          const symA = await resolveSym(tokenA);
          safeSetStep({ type: 'error', message: `Your wallet is blacklisted from ${symA}` });
          createSubmittingRef.current = false; setCreating(false); return;
        }
      }
      if (tokenB) {
        const statusB = await rpc.getTokenStatus(tokenB, userAddr);
        if (statusB.paused) {
          const symB = await resolveSym(tokenB);
          safeSetStep({ type: 'error', message: `${symB} is paused — cannot create pool` });
          createSubmittingRef.current = false; setCreating(false); return;
        }
        if (statusB.blacklisted) {
          const symB = await resolveSym(tokenB);
          safeSetStep({ type: 'error', message: `Your wallet is blacklisted from ${symB}` });
          createSubmittingRef.current = false; setCreating(false); return;
        }
      }
    } catch { /* noop */ }

    const factoryAddr = CONTRACTS.factory;
    if (!factoryAddr) {
      safeSetStep({ type: 'error', message: 'Factory contract not configured' });
      createSubmittingRef.current = false; setCreating(false); return;
    }
    const walletSnapshot = walletService.address;
    if (!walletSnapshot) {
      safeSetStep({ type: 'error', message: 'Wallet not connected' });
      createSubmittingRef.current = false; setCreating(false); return;
    }

    try {
      const bal = await rpc.getBalance(walletService.address);
      const minRequired = 1000000n;
      const rawOCT = parseRawBalance(bal.balance_raw, 6);
      if (BigInt(rawOCT) < minRequired) {
        const octBal = Number(rawOCT) / 1_000_000;
        throw new Error(`Insufficient OCT for pool creation. Need at least 1 OCT, have ${octBal.toFixed(6)} OCT.`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Insufficient')) {
        safeSetStep({ type: 'error', message: e.message });
        createSubmittingRef.current = false; setCreating(false); return;
      }
      console.warn('Balance pre-check failed:', e);
    }

    try {
      safeSetStep({ type: 'pre_approving' });

      const { num: feeNum, denom: feeDen } = getFeeParams();
      const maxRatio = 0;
      const liqA = initAmountA && metaA ? parseUnits(initAmountA, metaA.decimals) : null;
      const liqB = initAmountB && metaB ? parseUnits(initAmountB, metaB.decimals) : null;
      const hasLiq = !!(liqA && liqB && BigInt(liqA) > 0n && BigInt(liqB) > 0n);
      const minLp = hasLiq ? 1 : 0;
      const lockDuration = 0;

      // Pre-approve factory on both tokens (factory pulls tokens for add_liquidity)
      const grantPromises: Promise<string>[] = [];
      if (hasLiq && BigInt(liqA!) > 0n) {
        grantPromises.push(
          walletService.callContract({ contract: tokenA, method: 'grant', params: [factoryAddr, liqA!], rpc })
        );
      }
      if (hasLiq && BigInt(liqB!) > 0n) {
        grantPromises.push(
          walletService.callContract({ contract: tokenB, method: 'grant', params: [factoryAddr, liqB!], rpc })
        );
      }
      // NOTE: No WOCT grant needed here — SwapFactory.create() only pulls
      // token_a and token_b (WOCT grant only applies to factory.launch()).

      await Promise.all(grantPromises);
      await new Promise(r => setTimeout(r, 500));

      // Call factory.create() — single transaction
      safeSetStep({ type: 'creating' });

      // Get current epoch for deadline
      const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
      const currentEpoch = epochInfo.epoch_id || 0;
      const deadline = currentEpoch + 300;

      const createHash = await walletService.callContract({
        contract: factoryAddr,
        method: 'create',
        params: [
          tokenA, tokenB, feeNum, feeDen, maxRatio,
          liqA || '0', liqB || '0', minLp, deadline, lockDuration,
        ],
        rpc,
      });

      await rpc.waitForReceipt(createHash, 120);

      // Read pool address from factory
      // [FIX] Previously called `get_pool_by_index` which is NOT a factory method.
      // Use the canonical `get_pool(tokenA, tokenB)` view instead — it is defined
      // on SwapFactory and is the exact pool we just registered.
      let poolAddress = '';
      try {
        poolAddress = await rpc.getPoolAddress(factoryAddr, tokenA, tokenB);
      } catch { /* best-effort */ }

      if (mountedRef.current) {
        setStep({ type: 'done', poolAddress });
        rpc.clearCache();
        onPoolCreated();
      }
    } catch (e) {
      if (mountedRef.current) {
        const errMsg = e instanceof Error ? e.message : 'Unknown error';
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
    setFeeTier('0.30');
    setInitAmountA('');
    setInitAmountB('');
    setPairAlreadyExists(false);
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

  const stepDefs = [
    { key: 'pre_approving' as const, label: 'Granting allowances' },
    { key: 'creating' as const, label: 'Creating Pool' },
  ];

  const hasInitLiquidity = !!(initAmountA && metaA && initAmountB && metaB && Number(initAmountA) > 0 && Number(initAmountB) > 0);

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
      const priceAinB = Number(initAmountA) / Number(initAmountB);
      const priceBinA = Number(initAmountB) / Number(initAmountA);
      return { rawA, rawB, k, lpGross, lpNet, priceAinB, priceBinA };
    } catch { return null; }
  })();

  const stepType = step.type;
  const stepSnapshot = step;

  const step1Valid = isValidA && isValidB && hasValidPair;

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
            <span className={`text-xs font-medium ${wizardStep === s ? 'text-[var(--app-text)]' : 'text-[var(--app-muted)]'}`}>
              {s === 1 ? 'Tokens' : s === 2 ? 'Configure' : 'Liquidity'}
            </span>
            {idx < 2 && <div className={`flex-1 h-px mx-1 ${wizardStep > s ? 'bg-[var(--app-success)]' : 'bg-[var(--app-border)]'}`} />}
          </div>
        ))}
      </div>

      {(wizardStep === 2 || wizardStep === 3) && (metaA || metaB) && (
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className="bg-[var(--app-panel-soft)] rounded-full px-2 py-0.5 font-mono">{metaA ? metaA.symbol : '?'} / {metaB ? metaB.symbol : '?'}</span>
          <span className="bg-[var(--app-panel-soft)] rounded-full px-2 py-0.5">{feeTier === 'custom' ? `${customNum}/${customDenom}` : `${feeTier}%`}</span>
          {hasInitLiquidity && <span className="bg-[var(--app-panel-soft)] rounded-full px-2 py-0.5">w/ Liquidity</span>}
        </div>
      )}

      {step.type === 'idle' || step.type === 'error' ? (
        <>
          {wizardStep === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setShowTokenASelect(true)} className={`bg-[var(--app-panel-soft)] rounded-xl p-4 border transition-colors text-left ${isValidA ? 'border-[var(--app-blue)]/40 shadow-sm shadow-[var(--app-blue)]/10' : 'border-[var(--app-border)] hover:border-[var(--app-blue)]/50'}`}>
                  <div className="flex items-center gap-3">
                    {metaA ? (
                      <div className="w-9 h-9 rounded-full bg-[var(--app-blue)] flex items-center justify-center text-sm font-bold text-white shrink-0">{metaA.symbol[0]}</div>
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-[var(--app-hover)] flex items-center justify-center text-sm font-bold text-[var(--app-muted-2)] shrink-0">?</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-[var(--app-muted)] mb-1">Token A</div>
                      {metaA ? (
                        <>
                          <div className="text-base font-bold truncate">{metaA.symbol}</div>
                          <div className="text-[11px] text-[var(--app-muted)] truncate">{metaA.name}</div>
                          {walletAddress && (
                            <div className="text-[11px] text-[var(--app-muted-2)] mt-1 font-mono">{balanceA === null ? '...' : formatUnits(balanceA, metaA.decimals)}</div>
                          )}
                        </>
                      ) : (
                        <div className="text-sm text-[var(--app-muted-2)]">Select token</div>
                      )}
                    </div>
                  </div>
                </button>
                <TokenSelectModal isOpen={showTokenASelect} onClose={() => setShowTokenASelect(false)} onSelect={handleSelectTokenA} rpc={rpc} excludeAddress={tokenB || undefined} walletAddress={walletAddress} isConnected={isConnected} />
                <button onClick={() => setShowTokenBSelect(true)} className={`bg-[var(--app-panel-soft)] rounded-xl p-4 border transition-colors text-left ${isValidB ? 'border-[var(--app-blue)]/40 shadow-sm shadow-[var(--app-blue)]/10' : 'border-[var(--app-border)] hover:border-[var(--app-blue)]/50'}`}>
                  <div className="flex items-center gap-3">
                    {metaB ? (
                      <div className="w-9 h-9 rounded-full bg-[var(--app-blue-2)] flex items-center justify-center text-sm font-bold text-white shrink-0">{metaB.symbol[0]}</div>
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-[var(--app-hover)] flex items-center justify-center text-sm font-bold text-[var(--app-muted-2)] shrink-0">?</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-[var(--app-muted)] mb-1">Token B</div>
                      {metaB ? (
                        <>
                          <div className="text-base font-bold truncate">{metaB.symbol}</div>
                          <div className="text-[11px] text-[var(--app-muted)] truncate">{metaB.name}</div>
                          {walletAddress && (
                            <div className="text-[11px] text-[var(--app-muted-2)] mt-1 font-mono">{balanceB === null ? '...' : formatUnits(balanceB, metaB.decimals)}</div>
                          )}
                        </>
                      ) : (
                        <div className="text-sm text-[var(--app-muted-2)]">Select token</div>
                      )}
                    </div>
                  </div>
                </button>
                <TokenSelectModal isOpen={showTokenBSelect} onClose={() => setShowTokenBSelect(false)} onSelect={handleSelectTokenB} rpc={rpc} excludeAddress={tokenA || undefined} walletAddress={walletAddress} isConnected={isConnected} />
              </div>

              {step.type === 'error' && (
                <div className="text-sm text-[var(--app-danger)] bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-start gap-2">
                  <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span>{step.message}</span>
                </div>
              )}

              {isValidA && isValidB && !hasValidPair && (
                <div className="text-sm text-[var(--app-danger)] bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-start gap-2">
                  <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span>At least one token must already have a pair with WOCT</span>
                </div>
              )}

              {pairAlreadyExists && (
                <div className="text-sm text-[var(--app-danger)] bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 flex items-start gap-2">
                  <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span>This pair already has a pool — create would fail</span>
                </div>
              )}

              <button onClick={() => { if (!isConnected) { connect(); return; } setWizardStep(2); }} disabled={!step1Valid} className="w-full py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors">
                {!isConnected ? 'Connect Wallet' : 'Continue'}
              </button>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-4">
              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
                <div className="text-xs text-[var(--app-muted)] mb-2">Fee Tier</div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {feeTiers.map(f => (
                    <button key={f.value} onClick={() => setFeeTier(f.value)} className={`py-2.5 rounded-lg text-sm font-medium transition-colors ${feeTier === f.value ? 'bg-[var(--app-blue)] text-white' : 'bg-[var(--app-hover)] hover:bg-[var(--app-hover)] text-[var(--app-muted)]'}`}>{f.label}</button>
                  ))}
                </div>
                {feeTier === 'custom' && (
                  <div className="flex flex-col gap-2 mt-3">
                    <div className="flex gap-2">
                      <div className="flex-1"><label className="text-[10px] text-[var(--app-muted-2)]">Numerator</label><input type="number" value={customNum} onChange={e => setCustomNum(e.target.value)} className={`w-full bg-[var(--app-panel-soft)] border rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1 ${(() => { const n = parseInt(customNum, 10) || 0; const d = parseInt(customDenom, 10) || 1; return n <= 0 || d <= 0 || n >= d ? 'border-red-500/50' : 'border-[var(--app-border)]'; })()}`} min="1" /></div>
                      <div className="flex-1"><label className="text-[10px] text-[var(--app-muted-2)]">Denominator</label><input type="number" value={customDenom} onChange={e => setCustomDenom(e.target.value)} className={`w-full bg-[var(--app-panel-soft)] border rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1 ${(() => { const n = parseInt(customNum, 10) || 0; const d = parseInt(customDenom, 10) || 1; return n <= 0 || d <= 0 || n >= d ? 'border-red-500/50' : 'border-[var(--app-border)]'; })()}`} min="1" /></div>
                    </div>
                    <div className="text-[10px] text-[var(--app-muted)]">
                      {(() => {
                        const n = parseInt(customNum, 10) || 0; const d = parseInt(customDenom, 10) || 1;
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

              <div className="flex gap-3">
                <button onClick={() => setWizardStep(1)} className="flex-1 py-3 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl font-medium text-sm hover:bg-[var(--app-hover)] transition-colors">Back</button>
                <button onClick={() => setWizardStep(3)} disabled={!step1Valid} className="flex-[2] py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors">Continue</button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-4">
              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
                <div className="text-xs text-[var(--app-muted)] font-medium">Initial Liquidity (optional)</div>
                <div>
                  <label className="text-[10px] text-[var(--app-muted-2)]">{metaA?.symbol ?? 'Token A'}</label>
                  <input type="text" inputMode="decimal" value={initAmountA} onChange={e => setInitAmountA(sanitizeNumericInput(e.target.value))} placeholder="0.0" className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1" />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--app-muted-2)]">{metaB?.symbol ?? 'Token B'}</label>
                  <input type="text" inputMode="decimal" value={initAmountB} onChange={e => setInitAmountB(sanitizeNumericInput(e.target.value))} placeholder="0.0" className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm font-mono outline-none mt-1" />
                </div>
              </div>

              {sim && (
                <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-2 text-xs">
                  <div className="text-[10px] text-[var(--app-muted)] font-medium">Pool Preview</div>
                  <div className="flex justify-between"><span className="text-[var(--app-muted)]">Price</span><span className="font-mono">1 {metaA?.symbol} = {sim.priceAinB.toLocaleString(undefined, { maximumFractionDigits: 6 })} {metaB?.symbol}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--app-muted)]">LP minted</span><span className="font-mono">{formatUnits(sim.lpNet.toString(), 6)}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--app-muted)]">Your share</span><span className="font-mono">{sim.k > 0n ? '100' : '0'}%</span></div>
                </div>
              )}

              {!initAmountA && !initAmountB && (
                <div className="text-sm text-[var(--app-muted)] bg-[var(--app-panel-soft)] rounded-lg px-3 py-2 text-center">Skip liquidity to create an empty pool</div>
              )}

              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-2 text-sm">
                <div className="text-[10px] text-[var(--app-muted)] font-medium mb-2">Review</div>
                <div className="flex justify-between"><span className="text-[var(--app-muted)]">Pair</span><span className="font-mono font-medium">{metaA?.symbol ?? '?'} / {metaB?.symbol ?? '?'}</span></div>
                <div className="flex justify-between"><span className="text-[var(--app-muted)]">Fee Tier</span><span className="font-mono font-medium">{feeTier === 'custom' ? `${customNum}/${customDenom}` : `${feeTier}%`}</span></div>
                {hasInitLiquidity && (
                  <div className="flex justify-between"><span className="text-[var(--app-muted)]">Liquidity</span><span className="font-mono font-medium">{initAmountA} {metaA?.symbol} + {initAmountB} {metaB?.symbol}</span></div>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setWizardStep(2)} className="flex-1 py-3 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl font-medium text-sm hover:bg-[var(--app-hover)] transition-colors">Back</button>
                <button onClick={handleCreatePool} disabled={creating} className="flex-[2] py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors">
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
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div><div className="text-base font-semibold text-[var(--app-success)]">Pool Created</div><div className="text-xs text-[var(--app-muted)]">Your pool is now live</div></div>
          </div>
          <div className="text-sm text-[var(--app-muted)] break-all font-mono bg-[var(--app-panel)] rounded-lg px-3 py-2">Pool: {'poolAddress' in stepSnapshot ? stepSnapshot.poolAddress : ''}</div>
          <button onClick={() => navigate(`/liquidity?pool=${'poolAddress' in stepSnapshot ? stepSnapshot.poolAddress : ''}`)} className="w-full py-2.5 bg-green-600 hover:bg-green-700 rounded-xl text-sm font-medium transition-colors">Add / Manage Liquidity</button>
          <button onClick={reset} className="w-full py-2.5 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] rounded-xl text-sm font-medium hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] transition-colors">Create Another Pool</button>
        </div>
      ) : null}
    </div>
    </>
  );
}

export default CreatePoolForm;