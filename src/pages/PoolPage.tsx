import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import type { OctraRpc } from '../services/octraRpc';
import { CONTRACTS, WOCT_TOKEN } from '../types';
import { formatUnits, parseUnits } from '../services/swapService';
import { walletService } from '../services/walletService';
import TokenTrustBadge from '../components/TokenTrustBadge';
import TokenSelectModal from '../components/TokenSelectModal';

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

function CreatePoolForm({ rpc, isConnected, onPoolCreated }: {
  rpc: OctraRpc;
  isConnected: boolean;
  onPoolCreated: () => void;
}) {
  const navigate = useNavigate();
  const [tokenA, setTokenA] = useState('');
  const [tokenB, setTokenB] = useState('');
  const [metaA, setMetaA] = useState<TokenMeta | null>(null);
  const [metaB, setMetaB] = useState<TokenMeta | null>(null);
  const [trustedA, setTrustedA] = useState(false);
  const [trustedB, setTrustedB] = useState(false);
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
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!tokenA || !tokenB) { setHasValidPair(false); return; }
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

  const handleSelectTokenA = (address: string, meta: TokenMeta) => {
    setTokenA(address);
    setMetaA(meta);
    setInitAmountA('');
    rpc.isTrustedToken(CONTRACTS.factory, address).then(t => { if (mountedRef.current) setTrustedA(t); });
  };

  const handleSelectTokenB = (address: string, meta: TokenMeta) => {
    setTokenB(address);
    setMetaB(meta);
    setInitAmountB('');
    rpc.isTrustedToken(CONTRACTS.factory, address).then(t => { if (mountedRef.current) setTrustedB(t); });
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
      return { num, denom };
    }
    return { num: 3, denom: 1000 };
  };

  const handleCreatePool = async () => {
    if (!tokenA || !tokenB) return;
    // [V6-SECURITY-FIX MED-13] Double-submit guard
    if (creating) return;
    setCreating(true);
    const factoryAddr = CONTRACTS.factory;
    if (!factoryAddr) {
      setStep({ type: 'error', message: 'Factory contract not configured' });
      return;
    }

    try {
      setStep({ type: 'compiling' });

      const sourceResp = await fetch('/contracts/SwapPool.aml');
      const source = await sourceResp.text();

      const compileResult = await rpc.compileAml(source);
      const bytecode = compileResult.bytecode;

      setStep({ type: 'computing_address' });

      const balance = await rpc.call<{ balance: string; nonce: number }>('octra_balance', [walletService.address]);
      const deployNonce = balance.nonce + 1;

      const addrResult = await rpc.computeContractAddress(bytecode, walletService.address, deployNonce);
      const poolAddress = addrResult.address;

      setStep({ type: 'deploying' });

      const deployTxHash = await walletService.signAndSubmitDeployTx(rpc, {
        bytecode,
        poolAddress,
      });

      await rpc.waitForReceipt(deployTxHash, 60);

      setStep({ type: 'setting_tokens' });

      const tokenTxHash = await walletService.callContract({
        contract: poolAddress,
        method: 'set_tokens',
        params: [tokenA, tokenB],
      });

      await rpc.waitForReceipt(tokenTxHash, 60);

      setStep({ type: 'setting_fee' });

      const { num, denom } = getFeeParams();
      const feeTxHash = await walletService.callContract({
        contract: poolAddress,
        method: 'set_fee_params',
        params: [num, denom],
      });

      await rpc.waitForReceipt(feeTxHash, 60);

      setStep({ type: 'registering' });

      const regTxHash = await walletService.callContract({
        contract: factoryAddr,
        method: 'register_pool',
        params: [tokenA, tokenB, poolAddress],
      });

      await rpc.waitForReceipt(regTxHash, 60);

      const rawInitA = initAmountA && parseUnits(initAmountA, metaA!.decimals);
      const rawInitB = initAmountB && parseUnits(initAmountB, metaB!.decimals);

      if (rawInitA && rawInitB && BigInt(rawInitA) > 0 && BigInt(rawInitB) > 0) {
        setStep({ type: 'granting_a' });

        const grantAHash = await walletService.callContract({
          contract: tokenA,
          method: 'grant',
          params: [poolAddress, rawInitA],
        });
        await rpc.waitForReceipt(grantAHash, 60);

        setStep({ type: 'granting_b' });

        const grantBHash = await walletService.callContract({
          contract: tokenB,
          method: 'grant',
          params: [poolAddress, rawInitB],
        });
        await rpc.waitForReceipt(grantBHash, 60);

        setStep({ type: 'adding_liquidity' });

        const deadline = Math.floor(Date.now() / 1000 + 300);
        const addHash = await walletService.callContract({
          contract: poolAddress,
          method: 'add_liquidity',
          params: [rawInitA, rawInitB, '1', String(deadline), '0'],
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
        setStep({ type: 'error', message: e instanceof Error ? e.message : 'Unknown error' });
      }
    } finally {
      setCreating(false);
    }
  };

  const reset = () => {
    setStep({ type: 'idle' });
    setTokenA('');
    setTokenB('');
    setMetaB(null);
    setTrustedB(false);
    setFeeTier('0.30');
  };

  const stepLabel = (): string => {
    switch (step.type) {
      case 'compiling': return 'Compiling SwapPool contract...';
      case 'computing_address': return 'Computing pool address...';
      case 'deploying': return 'Deploying SwapPool (sign transaction)...';
      case 'setting_tokens': return 'Setting pool tokens (sign transaction)...';
      case 'setting_fee': return 'Setting pool fee (sign transaction)...';
      case 'registering': return 'Registering pool on factory (sign transaction)...';
      case 'granting_a': return `Granting ${metaA?.symbol ?? 'Token A'} to pool (sign transaction)...`;
      case 'granting_b': return `Granting ${metaB?.symbol ?? 'Token B'} to pool (sign transaction)...`;
      case 'adding_liquidity': return 'Adding initial liquidity (sign transaction)...';
      case 'done': return 'Pool created successfully!';
      case 'error': return 'Error: ' + step.message;
      default: return '';
    }
  };

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
                className={`w-full flex items-center justify-between bg-[var(--app-panel-soft)] text-sm font-medium outline-none rounded-lg px-3 py-2 border border-[var(--app-border)] hover:border-[#3B82F6] transition-colors ${tokenA ? '' : 'text-[var(--app-muted-2)]'}`}
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
                  <TokenTrustBadge isTrusted={trustedA} />
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
                className={`w-full flex items-center justify-between bg-[var(--app-panel-soft)] text-sm font-medium outline-none rounded-lg px-3 py-2 border border-[var(--app-border)] hover:border-[#3B82F6] transition-colors ${tokenB ? '' : 'text-[var(--app-muted-2)]'}`}
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
                  <TokenTrustBadge isTrusted={trustedB} />
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
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
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
                    className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-1.5 text-sm font-mono outline-none mt-1"
                    min="1"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-[var(--app-muted-2)]">Denominator</label>
                  <input
                    type="number"
                    value={customDenom}
                    onChange={e => setCustomDenom(e.target.value)}
                    className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-1.5 text-sm font-mono outline-none mt-1"
                    min="1"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
            <div className="text-xs text-[var(--app-muted)] font-medium">Initial Liquidity (optional)</div>
            <div>
              <label className="text-[10px] text-[var(--app-muted-2)]">{metaA?.symbol ?? 'Token A'} Amount</label>
              <input
                type="text"
                value={initAmountA}
                onChange={e => setInitAmountA(e.target.value)}
                placeholder="0.0"
                className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-1.5 text-sm font-mono outline-none mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--app-muted-2)]">{metaB?.symbol ?? 'Token B'} Amount</label>
              <input
                type="text"
                value={initAmountB}
                onChange={e => setInitAmountB(e.target.value)}
                placeholder="0.0"
                className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-1.5 text-sm font-mono outline-none mt-1"
              />
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
            onClick={handleCreatePool}
            disabled={!isConnected || !isValidA || !isValidB || !hasValidPair || creating}
            className="w-full py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors"
          >
            {!isConnected ? 'Connect Wallet' : isValidA && isValidB && hasValidPair && initAmountA && initAmountB ? 'Create Pool + Add Liquidity' : 'Create Pool'}
          </button>
        </>
      ) : (
        <div className="bg-[var(--app-panel-soft)] rounded-xl p-6 border border-[var(--app-border)] space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-[var(--app-blue)] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-[var(--app-blue-3)]">{stepLabel()}</span>
          </div>
          {step.type === 'done' && (
            <div className="space-y-3">
              <div className="text-xs text-[var(--app-muted)] break-all font-mono bg-[var(--app-panel-soft)] rounded-lg px-3 py-2">
                Pool: {step.poolAddress}
              </div>
              <button
                onClick={() => navigate(`/liquidity?pool=${step.poolAddress}`)}
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
      )}
    </div>
  );
}

function PoolPage() {
  const { rpc, isConnected } = useApp();
  const navigate = useNavigate();
  const [pools, setPools] = useState<PoolDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

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
          const metaA = await rpc.getTokenMeta(info.tokenA);
          const metaB = await rpc.getTokenMeta(info.tokenB);
          if (!metaA.symbol || metaA.symbol === '???') continue;
          if (!metaB.symbol || metaB.symbol === '???') continue;
          const feeParams = await rpc.getPoolFeeParams(addr);
          let rewardsPerEpoch = 0;
          try {
            const oesAddr = CONTRACTS.oes || info.tokenB;
            const rewardsInfo = await rpc.getOesRewardsInfo(oesAddr);
            rewardsPerEpoch = rewardsInfo.rewardsPerEpoch;
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

  const totalLPAll = pools.reduce((sum, p) => sum + Number(p.totalLP), 0);

  return (
    <div className="max-w-3xl mx-auto pt-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Pools</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] rounded-xl text-sm font-medium hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] transition-colors"
        >
          Create Pool
        </button>
      </div>

      {showCreate && (
        <CreatePoolForm
          rpc={rpc}
          isConnected={isConnected}
          onPoolCreated={loadPools}
        />
      )}

      <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--app-border)]">
          <h3 className="text-sm font-semibold">Active Pools</h3>
        </div>
        <div className="p-6">
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
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
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

      <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-5">
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
            <div className="text-xs text-[var(--app-muted)]">24h Volume</div>
            <div className="font-medium mt-0.5">--</div>
          </div>
          <div>
            <div className="text-xs text-[var(--app-muted)]">24h Fees</div>
            <div className="font-medium mt-0.5">--</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PoolPage;
