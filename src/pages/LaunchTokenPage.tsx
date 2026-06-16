import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { sanitizeNumericInput } from '../services/swapService';

type LaunchStep =
  | { type: 'idle' }
  | { type: 'compiling' }
  | { type: 'computing_address' }
  | { type: 'deploying' }
  | { type: 'done'; tokenAddress: string }
  | { type: 'error'; message: string };

function LaunchTokenPage() {
  const { rpc, isConnected, network, connect } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState(6);
  const [supply, setSupply] = useState('');
  const [step, setStep] = useState<LaunchStep>({ type: 'idle' });

  const mountedRef = useRef(true);
  const launchingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // [SECURITY] F-5: Save launch state to localStorage to allow recovery after error.
  // Cleared on success or explicit user action.
  useEffect(() => {
    if (step.type === 'idle' || step.type === 'done' || step.type === 'error') {
      try { localStorage.removeItem('launchTokenState'); } catch { /* localStorage unavailable */ }
    } else {
      try {
        const snapshot = { symbol, name, decimals, supply, step: step.type };
        localStorage.setItem('launchTokenState', JSON.stringify(snapshot));
      } catch { /* localStorage unavailable */ }
    }
  }, [step.type, symbol, name, decimals, supply]);

  // [SECURITY] F-5: On mount, check for an interrupted launch and offer to resume.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('launchTokenState');
      if (saved) {
        const parsed = JSON.parse(saved) as { symbol?: string; name?: string; decimals?: number; supply?: string; step?: string };
        if (parsed.step && parsed.step !== 'idle' && parsed.step !== 'done') {
          setStep({ type: 'error', message: `Previous launch interrupted at step: ${parsed.step}. Please review and try again.` });
        }
        try { localStorage.removeItem('launchTokenState'); } catch { /* noop */ }
      }
    } catch { /* noop */ }
  }, []);

  const rawSupply = (() => {
    // [SECURITY] FM-5: Use BigInt for parsing to avoid silent truncation to 2^31-1
    // from parseInt. Validate that the value fits safely.
    const trimmed = supply.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return null;
    try {
      const s = BigInt(trimmed);
      if (s <= 0n) return null;
      // Cap supply at 2^63 to avoid BigInt overflow in the AML compiler
      const MAX = BigInt(Number.MAX_SAFE_INTEGER);
      if (s > MAX) return null;
      return s * BigInt(10) ** BigInt(decimals);
    } catch {
      return null;
    }
  })();

  const errors: string[] = [];
  if (!name.trim()) errors.push('Name is required');
  else if (name.trim().length > 32) errors.push('Name must be 32 characters or less');
  else if (!/^[a-zA-Z0-9 _.,'-]+$/.test(name.trim())) errors.push('Name contains invalid characters');
  if (!symbol.trim()) errors.push('Symbol is required');
  else if (symbol.trim().length > 12) errors.push('Symbol must be 12 characters or less');
  else if (!/^[a-zA-Z0-9 _-]+$/.test(symbol.trim())) errors.push('Symbol must contain only letters, numbers, spaces, hyphens, or underscores');
  if (isNaN(decimals) || decimals < 0 || decimals > 18) errors.push('Decimals must be 0-18');
  if (!supply.trim() || !/^\d+$/.test(supply.trim()) || rawSupply === null) errors.push('Supply must be a positive integer');
  if (rawSupply !== null && rawSupply > BigInt(Number.MAX_SAFE_INTEGER)) {
    errors.push('Raw supply too large — reduce supply or decimals');
  }

  const canLaunch = isConnected && errors.length === 0 && step.type === 'idle';

  const handleLaunch = async () => {
    if (!canLaunch) return;
    if (launchingRef.current) return;
    launchingRef.current = true;
    // [SECURITY] F-4: Snapshot the wallet address at the start of the flow.
    // If the wallet disconnects/changes account mid-flow, the deploy contract
    // address will be derived from the wrong identity.
    const walletSnapshot = walletService.address;
    if (!walletSnapshot) {
      setStep({ type: 'error', message: 'Wallet not connected' });
      launchingRef.current = false;
      return;
    }
    try {
      setStep({ type: 'compiling' });

      const sourceResp = await fetch('/contracts/Token.aml');
      const source = await sourceResp.text();

      const compileResult = await rpc.compileAml(source);
      const bytecode = compileResult.bytecode;

      setStep({ type: 'computing_address' });

      // [SECURITY] F-4: Re-verify wallet hasn't changed and use the snapshot
      if (walletService.address !== walletSnapshot) {
        throw new Error('Wallet changed during launch — aborting');
      }
      const balance = await rpc.call<{ balance: string; nonce: number }>('octra_balance', [walletSnapshot]);
      if (walletService.address !== walletSnapshot) {
        throw new Error('Wallet changed during launch — aborting');
      }
      const deployNonce = balance.nonce + 1;

      const addrResult = await rpc.computeContractAddress(bytecode, walletSnapshot, deployNonce);
      const tokenAddress = addrResult.address;

      setStep({ type: 'deploying' });

      // [V7-SECURITY-FIX] Use string serialization to avoid BigInt→Number precision loss
      const constructorMessage = JSON.stringify([
        name.trim(),
        symbol.trim().toUpperCase(),
        rawSupply!.toString(),
        decimals,
      ]);

      const deployTxHash = await walletService.signAndSubmitDeployTx(rpc, {
        bytecode,
        poolAddress: tokenAddress,
        message: constructorMessage,
      });

      await rpc.waitForReceipt(deployTxHash, 60);

      if (mountedRef.current) {
        setStep({ type: 'done', tokenAddress });
        rpc.clearCache();
      }
    } catch (e) {
      if (mountedRef.current) {
        setStep({ type: 'error', message: e instanceof Error ? e.message : 'Unknown error' });
      }
    } finally {
      launchingRef.current = false;
    }
  };

  const stepLabel = (): string => {
    switch (step.type) {
      case 'compiling': return 'Compiling Token contract...';
      case 'computing_address': return 'Computing token address...';
      case 'deploying': return 'Deploying Token (sign transaction)...';
      case 'done': return 'Token launched successfully!';
      case 'error': return 'Error: ' + step.message;
      default: return '';
    }
  };

  const reset = () => {
    setStep({ type: 'idle' });
    setName('');
    setSymbol('');
    setDecimals(6);
    setSupply('');
  };

  return (
    <div className="max-w-2xl mx-auto pt-4 space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Launch Token</h2>
        <p className="text-sm text-[var(--app-muted)] mt-1">Deploy a new token on EverestSwap</p>
      </div>

      {step.type === 'idle' || step.type === 'error' ? (
        <>
          <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-5">
            <h3 className="text-sm font-semibold">Token Details</h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--app-muted)]">Token Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="My Token"
                  maxLength={32}
                  className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors"
                />
                <div className="text-[10px] text-[var(--app-muted-2)] text-right">{name.length}/32</div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--app-muted)]">Token Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={e => setSymbol(e.target.value)}
                  placeholder="MTK"
                  maxLength={12}
                  className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors uppercase"
                />
                <div className="text-[10px] text-[var(--app-muted-2)] text-right">{symbol.length}/12</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--app-muted)]">Decimals</label>
                <input
                  type="number"
                  value={decimals}
                  onChange={e => setDecimals(Math.max(0, Math.min(18, parseInt(e.target.value, 10) || 0)))}
                  min={0}
                  max={18}
                  className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--app-muted)]">Total Supply</label>
                <input
                  type="text"
                  value={supply}
                  onChange={e => setSupply(sanitizeNumericInput(e.target.value))}
                  placeholder="1000000"
                  className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors"
                />
              </div>
            </div>

            {rawSupply !== null && (
              <div className="bg-[var(--app-panel-soft)] rounded-xl px-4 py-3 border border-[var(--app-border)]">
                <div className="text-[10px] text-[var(--app-muted-2)] uppercase tracking-wider">Raw Supply</div>
                <div className="text-sm font-mono mt-0.5 break-all">{rawSupply.toString()}</div>
                <div className="text-[10px] text-[var(--app-muted-2)] mt-1">
                  Passed to constructor: {supply} × 10<sup>{decimals}</sup>
                </div>
              </div>
            )}

            {name.trim() && symbol.trim() && (
              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
                <div className="text-xs text-[var(--app-muted)] mb-2">Preview</div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--app-blue)] to-[var(--app-blue-2)] flex items-center justify-center text-sm font-bold">
                    {symbol.trim()[0] || '?'}
                  </div>
                  <div>
                    <div className="font-medium">{name.trim()} ({symbol.trim().toUpperCase()})</div>
                    <div className="text-xs text-[var(--app-muted)]">
                      Supply: {parseInt(supply, 10)?.toLocaleString() || '0'} ({decimals} decimals)
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-5">
            <h3 className="text-sm font-semibold mb-3">Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--app-muted)]">Network</span>
                <span>{network === 'devnet' ? 'Devnet' : 'Mainnet'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--app-muted)]">Deploy Fee</span>
                <span>~100,000 OU</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--app-muted)]">Wallet</span>
                <span className="text-xs truncate max-w-[200px]">{walletService.address || 'Not connected'}</span>
              </div>
            </div>
          </div>

          {step.type === 'error' && (
            <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-4 py-3">
              {step.message}
            </div>
          )}

          <button
            onClick={() => {
              // [V7-FIX] If not connected, actually call connect() instead of
              // silently triggering handleLaunch (which would fail)
              if (!isConnected) { connect(); return; }
              handleLaunch();
            }}
            disabled={!isConnected ? false : !canLaunch}
            className="w-full py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:from-[var(--app-muted-2)] disabled:to-[var(--app-muted-2)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-all"
          >
            {!isConnected ? 'Connect Wallet' : 'Launch Token'}
          </button>

          {errors.length > 0 && (
            <div className="text-xs text-[var(--app-danger)] space-y-1">
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </>
      ) : (
        <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6">
          {step.type === 'done' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-green-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium">{stepLabel()}</span>
              </div>

              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
                <div className="text-xs text-[var(--app-muted)]">Token Address</div>
                <div className="font-mono text-sm break-all bg-[var(--app-hover)] rounded-lg px-3 py-2 select-all">
                  {step.tokenAddress}
                </div>
                <button
                  onClick={() => navigator.clipboard.writeText(step.tokenAddress)}
                  className="text-xs text-[var(--app-blue-2)] hover:text-[var(--app-blue-3)] transition-colors"
                >
                  Copy Address
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => navigate(`/pool`)}
                  className="py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] rounded-xl text-sm font-medium transition-colors"
                >
                  Create Pool
                </button>
                <button
                  onClick={reset}
                  className="py-3 bg-[var(--app-hover)] hover:bg-[var(--app-hover)] rounded-xl text-sm font-medium transition-colors"
                >
                  Launch Another
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-[var(--app-blue)] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[var(--app-blue-3)]">{stepLabel()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LaunchTokenPage;
