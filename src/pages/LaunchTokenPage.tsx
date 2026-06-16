import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { sanitizeNumericInput } from '../services/swapService';
import { EXPLORER_URL } from '../config';
import TokenEmojiPicker from '../components/TokenEmojiPicker';

// [V7-FIX] Token preset templates for common use cases
interface TokenPreset {
  id: string;
  label: string;
  emoji: string;
  defaults: { decimals: number; supply: string; description: string };
}

const PRESETS: TokenPreset[] = [
  { id: 'standard', label: 'Standard', emoji: '🚀', defaults: { decimals: 6, supply: '1000000', description: '' } },
  { id: 'memecoin', label: 'Memecoin', emoji: '💎', defaults: { decimals: 18, supply: '1000000000', description: 'A community-driven meme token.' } },
  { id: 'stablecoin', label: 'Stablecoin', emoji: '🪙', defaults: { decimals: 6, supply: '1000000', description: 'A stablecoin pegged to a reference asset.' } },
  { id: 'utility', label: 'Utility', emoji: '⚡', defaults: { decimals: 8, supply: '100000000', description: 'A utility token for platform access and rewards.' } },
  { id: 'governance', label: 'Governance', emoji: '🌐', defaults: { decimals: 6, supply: '10000000', description: 'A governance token for protocol decisions.' } },
  { id: 'reward', label: 'Reward', emoji: '🎁', defaults: { decimals: 9, supply: '1000000000', description: 'A reward token for ecosystem incentives.' } },
];

// [V7-FIX] Token metadata stored off-chain (localStorage) — links to token address
export interface TokenMetadata {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  emoji: string;
  description: string;
  twitter: string;
  telegram: string;
  website: string;
  category: string;
  network: string;
  deployer: string;
  launchedAt: number;
}

type LaunchStep =
  | { type: 'idle' }
  | { type: 'compiling' }
  | { type: 'computing_address' }
  | { type: 'deploying' }
  | { type: 'done'; tokenAddress: string }
  | { type: 'error'; message: string };

function LaunchTokenPage() {
  const { rpc, isConnected, network, connect, walletBalance, refreshBalance } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState(6);
  const [supply, setSupply] = useState('');
  const [step, setStep] = useState<LaunchStep>({ type: 'idle' });

  // [V7-FIX] Advanced features (UI-only, no contract changes)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activePreset, setActivePreset] = useState<string>('standard');
  const [emoji, setEmoji] = useState('🚀');
  const [description, setDescription] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [website, setWebsite] = useState('');
  const [recentLaunches, setRecentLaunches] = useState<TokenMetadata[]>([]);

  const mountedRef = useRef(true);
  const launchingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // [V7-FIX] Load recent launches from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('launchedTokens');
      if (saved) {
        const parsed = JSON.parse(saved) as TokenMetadata[];
        // Filter to current network
        const filtered = parsed.filter(t => t.network === network).slice(0, 6);
        setRecentLaunches(filtered);
      }
    } catch { /* noop */ }
  }, [network]);

  // [V7-FIX] Refresh wallet balance on mount so cost estimate is accurate
  useEffect(() => {
    if (isConnected) refreshBalance().catch(() => {});
  }, [isConnected, refreshBalance]);

  // [V7-FIX] Apply preset template — auto-fills decimals, supply, description
  const applyPreset = (presetId: string) => {
    const preset = PRESETS.find(p => p.id === presetId);
    if (!preset) return;
    setActivePreset(presetId);
    setEmoji(preset.emoji);
    setDecimals(preset.defaults.decimals);
    setSupply(preset.defaults.supply);
    if (preset.defaults.description && !description) {
      setDescription(preset.defaults.description);
    }
  };

  // [V7-FIX] Cost estimation — base deploy fee + network fee (~0.1 OCT)
  const estimatedCost = useMemo(() => {
    const baseFee = 100000;  // base deploy fee in OU
    const networkFee = 100000;  // ~0.1 OCT in OU
    return ((baseFee + networkFee) / 1_000_000).toFixed(4);
  }, []);

  // [V7-FIX] Check if deployer has enough balance
  const hasEnoughBalance = useMemo(() => {
    if (!walletBalance) return null;
    const bal = Number(walletBalance);
    const cost = parseFloat(estimatedCost);
    return bal >= cost;
  }, [walletBalance, estimatedCost]);

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

  const canLaunch = isConnected && errors.length === 0 && step.type === 'idle' && hasEnoughBalance !== false;

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
        // [V7-FIX] Save token metadata to localStorage (off-chain)
        // Persists emoji, description, social links for the user's own reference
        try {
          const metadata: TokenMetadata = {
            address: tokenAddress,
            name: name.trim(),
            symbol: symbol.trim().toUpperCase(),
            decimals,
            supply,
            emoji,
            description: description.trim(),
            twitter: twitter.trim(),
            telegram: telegram.trim(),
            website: website.trim(),
            category: activePreset,
            network,
            deployer: walletSnapshot,
            launchedAt: Date.now(),
          };
          const existing = JSON.parse(localStorage.getItem('launchedTokens') || '[]') as TokenMetadata[];
          existing.unshift(metadata);
          localStorage.setItem('launchedTokens', JSON.stringify(existing.slice(0, 50)));
          setRecentLaunches(existing.filter(t => t.network === network).slice(0, 6));
        } catch { /* localStorage unavailable */ }
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
    // [V7-FIX] Reset advanced fields too
    setEmoji('🚀');
    setDescription('');
    setTwitter('');
    setTelegram('');
    setWebsite('');
    setActivePreset('standard');
  };

  return (
    <div className="max-w-2xl mx-auto pt-4 space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Launch Token</h2>
        <p className="text-sm text-[var(--app-muted)] mt-1">Deploy a new token on EverestSwap</p>
      </div>

      {step.type === 'idle' || step.type === 'error' ? (
        <>
          {/* [V7-FIX] Token preset templates — click to auto-fill form */}
          <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-5">
            <h3 className="text-sm font-semibold mb-3">Quick Start Templates</h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset.id)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-colors ${
                    activePreset === preset.id
                      ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10'
                      : 'border-[var(--app-border)] hover:border-[var(--app-muted)] bg-[var(--app-panel-soft)]'
                  }`}
                >
                  <span className="text-2xl">{preset.emoji}</span>
                  <span className="text-xs font-medium">{preset.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[var(--app-muted-2)] mt-2">
              Templates auto-fill decimals, supply, and a starter description. Customize as needed.
            </p>
          </div>

          {/* [V7-FIX] Info banner about TokenV2 roadmap */}
          <div className="bg-[var(--app-blue)]/5 border border-[var(--app-blue)]/20 rounded-xl px-4 py-2.5 text-xs text-[var(--app-muted)]">
            <span className="font-medium text-[var(--app-blue-3)]">ℹ️</span> This is a simple ERC20 token.
            Advanced features (mint/burn/pause/fee/vesting) are planned for <span className="font-medium">TokenV2</span>.
            For now, enjoy basic transfer/grant functionality.
          </div>

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
                  {/* [V7-FIX] Show selected emoji (or fallback to first letter) */}
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--app-blue)] to-[var(--app-blue-2)] flex items-center justify-center text-lg">
                    {emoji || symbol.trim()[0] || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{name.trim()} ({symbol.trim().toUpperCase()})</div>
                    <div className="text-xs text-[var(--app-muted)]">
                      Supply: {parseInt(supply, 10)?.toLocaleString() || '0'} ({decimals} decimals)
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* [V7-FIX] Advanced Options — collapsible, default closed */}
          <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)]">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-6 py-4 text-sm font-semibold"
            >
              <span>Advanced Options {showAdvanced ? '▼' : '▶'}</span>
              <span className="text-xs font-normal text-[var(--app-muted)]">
                Emoji, description, social links
              </span>
            </button>
            {showAdvanced && (
              <div className="px-6 pb-6 space-y-5 border-t border-[var(--app-border)] pt-5">
                <TokenEmojiPicker value={emoji} onChange={setEmoji} />

                <div>
                  <label className="text-xs text-[var(--app-muted)]">Description (off-chain)</label>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    maxLength={280}
                    placeholder="A short description of your token (max 280 chars)"
                    rows={3}
                    className="w-full mt-1.5 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors resize-none"
                  />
                  <div className="text-[10px] text-[var(--app-muted-2)] text-right mt-0.5">
                    {description.length}/280
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-[var(--app-muted)]">Twitter (handle)</label>
                    <input
                      type="text"
                      value={twitter}
                      onChange={e => setTwitter(e.target.value)}
                      placeholder="@yourtoken"
                      maxLength={50}
                      className="w-full mt-1.5 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--app-muted)]">Telegram</label>
                    <input
                      type="text"
                      value={telegram}
                      onChange={e => setTelegram(e.target.value)}
                      placeholder="t.me/yourtoken"
                      maxLength={50}
                      className="w-full mt-1.5 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--app-muted)]">Website</label>
                    <input
                      type="text"
                      value={website}
                      onChange={e => setWebsite(e.target.value)}
                      placeholder="https://..."
                      maxLength={200}
                      className="w-full mt-1.5 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors"
                    />
                  </div>
                </div>

                <p className="text-[10px] text-[var(--app-muted-2)]">
                  These fields are stored off-chain (localStorage) and only visible to you in the post-launch view.
                </p>
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
                <span className="text-[var(--app-muted)]">Estimated Cost</span>
                <span className="font-mono">~{estimatedCost} OCT</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--app-muted)]">Wallet Balance</span>
                <span className={`font-mono ${hasEnoughBalance === false ? 'text-[var(--app-danger)]' : ''}`}>
                  {walletBalance ? `${(Number(walletBalance) / 1_000_000).toFixed(4)} OCT` : '—'}
                </span>
              </div>
              {hasEnoughBalance === false && (
                <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-3 py-2">
                  Insufficient balance for deploy. Need at least {estimatedCost} OCT.
                </div>
              )}
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
                <div className="flex items-center gap-3">
                  {/* [V7-FIX] Show selected emoji prominently */}
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[var(--app-blue)] to-[var(--app-blue-2)] flex items-center justify-center text-2xl">
                    {emoji}
                  </div>
                  <div>
                    <div className="font-medium">{name.trim()} ({symbol.trim().toUpperCase()})</div>
                    <div className="text-xs text-[var(--app-muted)]">Token launched successfully</div>
                  </div>
                </div>
                <div className="text-xs text-[var(--app-muted)] mt-2">Token Address</div>
                <div className="font-mono text-sm break-all bg-[var(--app-hover)] rounded-lg px-3 py-2 select-all">
                  {step.tokenAddress}
                </div>
              </div>

              {/* [V7-FIX] Post-launch action grid — Share, View, Copy, Create Pool */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    const shareText = `Just launched ${emoji} ${name.trim()} (${symbol.trim().toUpperCase()}) on @EverestSwap!`;
                    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(`${EXPLORER_URL}/address/${step.tokenAddress}`)}`;
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                  className="py-3 bg-[#1DA1F2]/20 hover:bg-[#1DA1F2]/30 border border-[#1DA1F2]/40 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <span>𝕏</span> Share
                </button>
                <a
                  href={`${EXPLORER_URL}/address/${step.tokenAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-3 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View Contract
                </a>
                <button
                  onClick={() => navigator.clipboard.writeText(step.tokenAddress)}
                  className="py-3 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Address
                </button>
                <button
                  onClick={() => navigate(`/pool`)}
                  className="py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] rounded-xl text-sm font-medium transition-colors"
                >
                  Create Pool
                </button>
                <button
                  onClick={reset}
                  className="col-span-2 py-3 bg-[var(--app-hover)] hover:bg-[var(--app-hover)] rounded-xl text-sm font-medium transition-colors"
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

      {/* [V7-FIX] Recent launches feed — loaded from localStorage */}
      {step.type === 'idle' && recentLaunches.length > 0 && (
        <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-5">
          <h3 className="text-sm font-semibold mb-3">Your Recent Launches ({network})</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {recentLaunches.map(token => (
              <a
                key={token.address}
                href={`${EXPLORER_URL}/address/${token.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[var(--app-panel-soft)] rounded-xl p-3 border border-[var(--app-border)] hover:border-[var(--app-blue)] transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">{token.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{token.symbol}</div>
                    <div className="text-[10px] text-[var(--app-muted)] truncate">
                      {new Date(token.launchedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="font-mono text-[10px] text-[var(--app-muted)] truncate">
                  {token.address}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default LaunchTokenPage;
