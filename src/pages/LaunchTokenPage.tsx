import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { sanitizeNumericInput } from '../services/swapService';
import type { TokenLaunchConfig } from '../types';
import { EXPLORER_URL } from '../config';

type LaunchStep =
  | { type: 'idle' }
  | { type: 'compiling' }
  | { type: 'computing_address' }
  | { type: 'deploying' }
  | { type: 'done'; tokenAddress: string }
  | { type: 'error'; message: string };

type WizardStep = 1 | 2 | 3 | 4;

const INITIAL_CONFIG: TokenLaunchConfig = {
  // Step 1: General
  name: '',
  symbol: '',
  contractName: '',
  initialSupply: '',
  decimals: 18,
  supplyRecipientMode: 'self',
  customSupplyRecipient: '',
  tokenOwnerMode: 'self',
  customTokenOwner: '',

  // Step 2: Optional Features
  mintable: false,
  maxSupply: '0',
  burnable: false,
  pausable: false,
  blacklist: false,
  maxTx: false,
  maxTxAmount: '0',
  maxWallet: false,
  maxWalletAmount: '0',
  cooldown: false,
  cooldownSeconds: '60',
  autoBurn: false,
  autoBurnBps: '100',
  reflection: false,

  // Step 3: Taxes
  tax: false,
  taxBps: '100',
  taxRecipientMode: 'self',
  customTaxRecipient: '',
};

// [V7-FIX] Convert string amount to BigInt safely (max Number.MAX_SAFE_INTEGER)
function toBigInt(s: string, decimals: number): bigint | null {
  if (!s || !/^\d+$/.test(s)) return null;
  try {
    const v = BigInt(s);
    if (v <= 0n) return null;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return v * BigInt(10) ** BigInt(decimals);
  } catch {
    return null;
  }
}

// [V7-FIX] Octra address validator: must start with 'oct' and be 40-60 chars
function isValidAddress(addr: string): boolean {
  if (!addr) return false;
  const t = addr.trim();
  return t.startsWith('oct') && t.length >= 40 && t.length <= 60;
}

function LaunchTokenPage() {
  const { rpc, isConnected, network, connect, walletBalance } = useApp();
  const navigate = useNavigate();
  const [config, setConfig] = useState<TokenLaunchConfig>(INITIAL_CONFIG);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [step, setStep] = useState<LaunchStep>({ type: 'idle' });

  const mountedRef = useRef(true);
  const launchingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // [V7-FIX] Auto-fill contract name from token name
  useEffect(() => {
    if (!config.contractName && config.name.trim()) {
      const auto = config.name.trim().replace(/[^a-zA-Z0-9]/g, '') + 'Token';
      setConfig(c => ({ ...c, contractName: auto }));
    }
  }, [config.name, config.contractName]);

  // [V7-FIX] Resolve supply recipient address based on mode
  const supplyRecipientAddress = useMemo(() => {
    if (config.supplyRecipientMode === 'self') return walletService.address || '';
    return config.customSupplyRecipient.trim();
  }, [config.supplyRecipientMode, config.customSupplyRecipient]);

  // [V7-FIX] Resolve token owner address based on mode
  const tokenOwnerAddress = useMemo(() => {
    if (config.tokenOwnerMode === 'self') return walletService.address || '';
    return config.customTokenOwner.trim();
  }, [config.tokenOwnerMode, config.customTokenOwner]);

  // [V7-FIX] Resolve tax recipient address based on mode
  const taxRecipientAddress = useMemo(() => {
    if (!config.tax) return '';
    if (config.taxRecipientMode === 'self') return walletService.address || '';
    if (config.taxRecipientMode === 'burn') return '';
    if (config.taxRecipientMode === 'lp') return 'lp_pool';
    return config.customTaxRecipient.trim();
  }, [config.tax, config.taxRecipientMode, config.customTaxRecipient]);

  // [V7-FIX] Per-step validation
  const step1Errors = useMemo(() => {
    const errs: string[] = [];
    if (!config.name.trim()) errs.push('Token name is required');
    else if (config.name.trim().length > 50) errs.push('Name must be 50 characters or less');
    else if (!/^[a-zA-Z0-9 _.,'-]+$/.test(config.name.trim())) errs.push('Name contains invalid characters');

    if (!config.symbol.trim()) errs.push('Token symbol is required');
    else if (config.symbol.trim().length > 20) errs.push('Symbol must be 20 characters or less');
    else if (!/^[a-zA-Z0-9 _-]+$/.test(config.symbol.trim())) errs.push('Symbol contains invalid characters');

    if (config.decimals < 1 || config.decimals > 18) errs.push('Decimals must be 1-18');

    if (!config.initialSupply.trim() || !/^\d+$/.test(config.initialSupply.trim())) {
      errs.push('Initial supply must be a positive integer');
    } else {
      const v = BigInt(config.initialSupply.trim());
      if (v <= 0n) errs.push('Initial supply must be positive');
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) errs.push('Initial supply too large');
    }

    if (config.supplyRecipientMode === 'custom' && !isValidAddress(config.customSupplyRecipient)) {
      errs.push('Custom supply recipient must be a valid Octra address (oct...)');
    }
    if (config.tokenOwnerMode === 'custom' && !isValidAddress(config.customTokenOwner)) {
      errs.push('Custom token owner must be a valid Octra address (oct...)');
    }

    return errs;
  }, [config]);

  const step2Errors = useMemo(() => {
    const errs: string[] = [];
    if (config.mintable && config.maxSupply && BigInt(config.maxSupply || '0') > 0n) {
      const ms = BigInt(config.maxSupply);
      const is = BigInt(config.initialSupply || '0');
      if (ms < is) errs.push('Max supply must be >= initial supply');
    }
    if (config.maxTx && (!config.maxTxAmount || BigInt(config.maxTxAmount || '0') <= 0n)) {
      errs.push('Max transaction amount must be > 0');
    }
    if (config.maxWallet && (!config.maxWalletAmount || BigInt(config.maxWalletAmount || '0') <= 0n)) {
      errs.push('Max wallet amount must be > 0');
    }
    if (config.cooldown) {
      const cd = parseInt(config.cooldownSeconds, 10);
      if (isNaN(cd) || cd < 1 || cd > 86400) errs.push('Cooldown must be 1-86400 seconds');
    }
    if (config.autoBurn) {
      const bps = parseInt(config.autoBurnBps, 10);
      if (isNaN(bps) || bps < 1 || bps > 1000) errs.push('Auto-burn must be 1-1000 bps (0.01%-10%)');
    }
    return errs;
  }, [config]);

  const step3Errors = useMemo(() => {
    const errs: string[] = [];
    if (config.tax) {
      const bps = parseInt(config.taxBps, 10);
      if (isNaN(bps) || bps < 1 || bps > 2500) errs.push('Tax must be 1-2500 bps (0.01%-25%)');
      if (config.autoBurn) {
        const ab = parseInt(config.autoBurnBps, 10) || 0;
        if (bps + ab > 2500) errs.push('Total fees (tax + auto-burn) cannot exceed 25%');
      }
      if (config.taxRecipientMode === 'custom' && !isValidAddress(config.customTaxRecipient)) {
        errs.push('Custom tax recipient must be a valid Octra address');
      }
    }
    return errs;
  }, [config]);

  const step1Valid = step1Errors.length === 0;
  const step2Valid = step2Errors.length === 0;
  const step3Valid = step3Errors.length === 0;

  const allErrors = [...step1Errors, ...step2Errors, ...step3Errors];
  const canLaunch = isConnected && allErrors.length === 0 && step.type === 'idle';

  // [V7-FIX] Cost estimation — base + per-feature gas
  const estimatedCost = useMemo(() => {
    let base = 200000;  // base deploy
    if (config.mintable) base += 20000;
    if (config.burnable) base += 20000;
    if (config.pausable) base += 20000;
    if (config.blacklist) base += 20000;
    if (config.maxTx) base += 20000;
    if (config.maxWallet) base += 20000;
    if (config.cooldown) base += 20000;
    if (config.tax) base += 30000;
    if (config.autoBurn) base += 30000;
    if (config.reflection) base += 20000;
    return (base / 1_000_000).toFixed(4);
  }, [config]);

  // [V7-FIX] Build the 25-arg constructor message for TokenV2
  const buildConstructorMessage = (): string | null => {
    const raw = toBigInt(config.initialSupply, config.decimals);
    if (!raw) return null;

    const maxTx = config.maxTx ? BigInt(config.maxTxAmount || '0') * BigInt(10) ** BigInt(config.decimals) : 0n;
    const maxWallet = config.maxWallet ? BigInt(config.maxWalletAmount || '0') * BigInt(10) ** BigInt(config.decimals) : 0n;
    const cooldownSecs = config.cooldown ? parseInt(config.cooldownSeconds, 10) : 0;
    const taxBps = config.tax ? parseInt(config.taxBps, 10) : 0;
    const taxRecipient = config.tax ? taxRecipientAddress : walletService.address || '';
    const autoBurnBps = config.autoBurn ? parseInt(config.autoBurnBps, 10) : 0;

    return JSON.stringify([
      config.name.trim(),                                    // 1. n
      config.symbol.trim().toUpperCase(),                    // 2. s
      config.contractName.trim() || (config.name.trim() + 'Token'),  // 3. contract_name
      raw.toString(),                                        // 4. initial_supply
      config.decimals,                                       // 5. dec
      tokenOwnerAddress,                                     // 6. initial_owner
      supplyRecipientAddress,                                // 7. supply_recipient
      0,                                                     // 8. max_supply (disabled for now)
      maxTx.toString(),                                      // 9. max_tx_amount
      maxWallet.toString(),                                  // 10. max_wallet_amount
      cooldownSecs,                                          // 11. cooldown_seconds
      taxBps,                                                // 12. tax_bps
      taxRecipient,                                          // 13. tax_recipient
      autoBurnBps,                                           // 14. auto_burn_bps
      config.mintable,                                       // 15
      config.burnable,                                       // 16
      config.pausable,                                       // 17
      config.blacklist,                                      // 18
      config.maxTx,                                          // 19
      config.maxWallet,                                      // 20
      config.cooldown,                                       // 21
      config.tax,                                            // 22
      config.autoBurn,                                       // 23
      config.reflection,                                     // 24
    ]);
  };

  const handleLaunch = async () => {
    if (!canLaunch) return;
    if (launchingRef.current) return;
    launchingRef.current = true;
    const walletSnapshot = walletService.address;
    if (!walletSnapshot) {
      setStep({ type: 'error', message: 'Wallet not connected' });
      launchingRef.current = false;
      return;
    }
    try {
      setStep({ type: 'compiling' });

      const sourceResp = await fetch('/contracts/TokenV2.aml');
      if (!sourceResp.ok) throw new Error('Failed to load TokenV2.aml source');
      const source = await sourceResp.text();

      const compileResult = await rpc.compileAml(source);
      const bytecode = compileResult.bytecode;

      setStep({ type: 'computing_address' });

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

      const constructorMessage = buildConstructorMessage();
      if (!constructorMessage) throw new Error('Invalid supply value');

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
      case 'compiling': return 'Compiling TokenV2 contract...';
      case 'computing_address': return 'Computing token address...';
      case 'deploying': return 'Deploying TokenV2 (sign transaction)...';
      case 'done': return 'Token launched successfully!';
      case 'error': return 'Error: ' + step.message;
      default: return '';
    }
  };

  const reset = () => {
    setStep({ type: 'idle' });
    setConfig(INITIAL_CONFIG);
    setWizardStep(1);
  };

  const update = <K extends keyof TokenLaunchConfig>(key: K, value: TokenLaunchConfig[K]) => {
    setConfig(c => ({ ...c, [key]: value }));
  };

  const goNext = () => {
    if (wizardStep === 1 && step1Valid) setWizardStep(2);
    else if (wizardStep === 2 && step2Valid) setWizardStep(3);
    else if (wizardStep === 3 && step3Valid) setWizardStep(4);
  };

  const goBack = () => {
    if (wizardStep > 1) setWizardStep((wizardStep - 1) as WizardStep);
  };

  // ========== RENDER ==========
  return (
    <div className="max-w-3xl mx-auto pt-4 space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Launch Token</h2>
        <p className="text-sm text-[var(--app-muted)] mt-1">
          Deploy a feature-rich token on EverestSwap
        </p>
      </div>

      {/* ====== Step tabs ====== */}
      {step.type === 'idle' || step.type === 'error' ? (
        <>
          <div className="flex items-center gap-2">
            {([1, 2, 3, 4] as WizardStep[]).map(s => {
              const labels = ['General', 'Optional', 'Taxes', 'Summary'];
              const isActive = wizardStep === s;
              const isComplete = s < wizardStep;
              return (
                <button
                  key={s}
                  onClick={() => {
                    if (s === 1) setWizardStep(1);
                    else if (s === 2 && step1Valid) setWizardStep(2);
                    else if (s === 3 && step1Valid && step2Valid) setWizardStep(3);
                    else if (s === 4 && step1Valid && step2Valid && step3Valid) setWizardStep(4);
                  }}
                  className={`flex-1 py-2 px-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10 text-[var(--app-blue-3)]'
                      : isComplete
                      ? 'border-green-500/40 bg-green-500/5 text-green-400'
                      : 'border-[var(--app-border)] text-[var(--app-muted)]'
                  }`}
                >
                  <span className="text-xs opacity-70 mr-1">{s}.</span> {labels[s - 1]}
                </button>
              );
            })}
          </div>

          {/* ====== Step 1: General ====== */}
          {wizardStep === 1 && (
            <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-5">
              <h3 className="text-sm font-semibold">1. General</h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--app-muted)]">
                    Token Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={config.name}
                    onChange={e => update('name', e.target.value)}
                    placeholder="My Awesome Token"
                    maxLength={50}
                    className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors"
                  />
                  <div className="text-[10px] text-[var(--app-muted-2)] text-right">{config.name.length}/50</div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--app-muted)]">
                    Token Symbol <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={config.symbol}
                    onChange={e => update('symbol', e.target.value)}
                    placeholder="MAT"
                    maxLength={20}
                    className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors uppercase"
                  />
                  <div className="text-[10px] text-[var(--app-muted-2)] text-right">{config.symbol.length}/20</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--app-muted)]">Contract Name</label>
                <input
                  type="text"
                  value={config.contractName}
                  onChange={e => update('contractName', e.target.value)}
                  placeholder="MyAwesomeToken"
                  maxLength={50}
                  className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors"
                />
                <p className="text-[10px] text-[var(--app-muted-2)]">
                  Used for verification. Auto-derived from token name if left empty.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--app-muted)]">
                    Initial Supply <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={config.initialSupply}
                    onChange={e => update('initialSupply', sanitizeNumericInput(e.target.value))}
                    placeholder="1000000"
                    className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--app-muted)]">Decimals</label>
                  <div className="flex gap-2">
                    {[6, 9, 18].map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => update('decimals', d)}
                        className={`flex-1 py-2 rounded-xl border-2 text-sm font-medium transition-colors ${
                          config.decimals === d
                            ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10 text-[var(--app-blue-3)]'
                            : 'border-[var(--app-border)] text-[var(--app-muted)] hover:border-[var(--app-muted-2)]'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--app-muted)]">Supply Recipient</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => update('supplyRecipientMode', 'self')}
                    className={`py-2 rounded-xl border-2 text-sm font-medium ${
                      config.supplyRecipientMode === 'self'
                        ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10'
                        : 'border-[var(--app-border)]'
                    }`}
                  >
                    My wallet
                  </button>
                  <button
                    type="button"
                    onClick={() => update('supplyRecipientMode', 'custom')}
                    className={`py-2 rounded-xl border-2 text-sm font-medium ${
                      config.supplyRecipientMode === 'custom'
                        ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10'
                        : 'border-[var(--app-border)]'
                    }`}
                  >
                    Different address
                  </button>
                </div>
                {config.supplyRecipientMode === 'custom' && (
                  <input
                    type="text"
                    value={config.customSupplyRecipient}
                    onChange={e => update('customSupplyRecipient', e.target.value)}
                    placeholder="oct..."
                    className="w-full mt-2 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:border-[var(--app-blue)] transition-colors"
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-[var(--app-muted)]">Token Owner</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => update('tokenOwnerMode', 'self')}
                    className={`py-2 rounded-xl border-2 text-sm font-medium ${
                      config.tokenOwnerMode === 'self'
                        ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10'
                        : 'border-[var(--app-border)]'
                    }`}
                  >
                    My wallet
                  </button>
                  <button
                    type="button"
                    onClick={() => update('tokenOwnerMode', 'custom')}
                    className={`py-2 rounded-xl border-2 text-sm font-medium ${
                      config.tokenOwnerMode === 'custom'
                        ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10'
                        : 'border-[var(--app-border)]'
                    }`}
                  >
                    Different address
                  </button>
                </div>
                {config.tokenOwnerMode === 'custom' && (
                  <input
                    type="text"
                    value={config.customTokenOwner}
                    onChange={e => update('customTokenOwner', e.target.value)}
                    placeholder="oct..."
                    className="w-full mt-2 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:border-[var(--app-blue)] transition-colors"
                  />
                )}
                <p className="text-[10px] text-[var(--app-muted-2)]">
                  Owner can manage token features (mint, burn, pause, etc.)
                </p>
              </div>

              {step1Errors.length > 0 && (
                <div className="text-xs text-[var(--app-danger)] space-y-1">
                  {step1Errors.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}
            </div>
          )}

          {/* ====== Step 2: Optional Features ====== */}
          {wizardStep === 2 && (
            <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-5">
              <h3 className="text-sm font-semibold">2. Optional Features</h3>
              <p className="text-xs text-[var(--app-muted)]">Toggle the features you want to enable.</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Mintable */}
                <FeatureCard
                  title="Mintable"
                  desc="Owner can mint new tokens after launch"
                  enabled={config.mintable}
                  onToggle={() => update('mintable', !config.mintable)}
                >
                  <label className="text-[10px] text-[var(--app-muted-2)]">Max Supply (0 = uncapped)</label>
                  <input
                    type="text"
                    value={config.maxSupply}
                    onChange={e => update('maxSupply', sanitizeNumericInput(e.target.value))}
                    placeholder="0"
                    disabled={!config.mintable}
                    className="w-full mt-1 bg-[var(--app-bg)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)] disabled:opacity-50"
                  />
                </FeatureCard>

                {/* Burnable */}
                <FeatureCard
                  title="Burnable"
                  desc="Holders can burn their tokens"
                  enabled={config.burnable}
                  onToggle={() => update('burnable', !config.burnable)}
                />

                {/* Pausable */}
                <FeatureCard
                  title="Pausable"
                  desc="Owner can pause all transfers"
                  enabled={config.pausable}
                  onToggle={() => update('pausable', !config.pausable)}
                />

                {/* Blacklist */}
                <FeatureCard
                  title="Blacklist"
                  desc="Owner can blacklist addresses"
                  enabled={config.blacklist}
                  onToggle={() => update('blacklist', !config.blacklist)}
                />

                {/* Max Tx */}
                <FeatureCard
                  title="Max Transaction"
                  desc="Cap on transfer size (anti-bot)"
                  enabled={config.maxTx}
                  onToggle={() => update('maxTx', !config.maxTx)}
                >
                  <label className="text-[10px] text-[var(--app-muted-2)]">Max tx amount (tokens)</label>
                  <input
                    type="text"
                    value={config.maxTxAmount}
                    onChange={e => update('maxTxAmount', sanitizeNumericInput(e.target.value))}
                    placeholder="10000"
                    disabled={!config.maxTx}
                    className="w-full mt-1 bg-[var(--app-bg)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)] disabled:opacity-50"
                  />
                </FeatureCard>

                {/* Max Wallet */}
                <FeatureCard
                  title="Max Wallet"
                  desc="Cap on wallet size (anti-whale)"
                  enabled={config.maxWallet}
                  onToggle={() => update('maxWallet', !config.maxWallet)}
                >
                  <label className="text-[10px] text-[var(--app-muted-2)]">Max wallet amount (tokens)</label>
                  <input
                    type="text"
                    value={config.maxWalletAmount}
                    onChange={e => update('maxWalletAmount', sanitizeNumericInput(e.target.value))}
                    placeholder="50000"
                    disabled={!config.maxWallet}
                    className="w-full mt-1 bg-[var(--app-bg)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)] disabled:opacity-50"
                  />
                </FeatureCard>

                {/* Cooldown */}
                <FeatureCard
                  title="Cooldown"
                  desc="Wait time between txs per address"
                  enabled={config.cooldown}
                  onToggle={() => update('cooldown', !config.cooldown)}
                >
                  <label className="text-[10px] text-[var(--app-muted-2)]">Cooldown (seconds, 1-86400)</label>
                  <input
                    type="number"
                    value={config.cooldownSeconds}
                    onChange={e => update('cooldownSeconds', e.target.value)}
                    placeholder="60"
                    min={1}
                    max={86400}
                    disabled={!config.cooldown}
                    className="w-full mt-1 bg-[var(--app-bg)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)] disabled:opacity-50"
                  />
                </FeatureCard>

                {/* Auto-burn */}
                <FeatureCard
                  title="Auto-burn"
                  desc="Burn % of every transfer (deflationary)"
                  enabled={config.autoBurn}
                  onToggle={() => update('autoBurn', !config.autoBurn)}
                >
                  <label className="text-[10px] text-[var(--app-muted-2)]">Auto-burn (bps, 1-1000)</label>
                  <input
                    type="number"
                    value={config.autoBurnBps}
                    onChange={e => update('autoBurnBps', e.target.value)}
                    placeholder="100"
                    min={1}
                    max={1000}
                    disabled={!config.autoBurn}
                    className="w-full mt-1 bg-[var(--app-bg)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)] disabled:opacity-50"
                  />
                  <p className="text-[10px] text-[var(--app-muted-2)] mt-1">
                    100 bps = 1% burned per transfer
                  </p>
                </FeatureCard>

                {/* Reflection */}
                <FeatureCard
                  title="Reflection (RFI)"
                  desc="Distribute % of transfers to holders"
                  enabled={config.reflection}
                  onToggle={() => update('reflection', !config.reflection)}
                />
              </div>

              {step2Errors.length > 0 && (
                <div className="text-xs text-[var(--app-danger)] space-y-1">
                  {step2Errors.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}
            </div>
          )}

          {/* ====== Step 3: Taxes ====== */}
          {wizardStep === 3 && (
            <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-5">
              <h3 className="text-sm font-semibold">3. Taxes</h3>

              <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--app-panel-soft)] border border-[var(--app-border)]">
                <div>
                  <div className="font-medium text-sm">Trading Tax</div>
                  <div className="text-xs text-[var(--app-muted)] mt-0.5">Charge a fee on every transfer</div>
                </div>
                <button
                  type="button"
                  onClick={() => update('tax', !config.tax)}
                  className={`w-12 h-6 rounded-full transition-colors ${
                    config.tax ? 'bg-[var(--app-blue)]' : 'bg-[var(--app-muted-2)]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      config.tax ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {config.tax && (
                <>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--app-muted)]">Tax Rate</span>
                      <span className="font-mono font-medium">{(parseInt(config.taxBps, 10) / 100).toFixed(2)}%</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={2500}
                      step={10}
                      value={config.taxBps}
                      onChange={e => update('taxBps', e.target.value)}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-[var(--app-muted-2)]">
                      <span>0.01%</span>
                      <span>25% (max)</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--app-muted)]">Tax Recipient</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(['self', 'lp', 'burn', 'custom'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => update('taxRecipientMode', mode)}
                          className={`py-2 rounded-xl border-2 text-xs font-medium ${
                            config.taxRecipientMode === mode
                              ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10'
                              : 'border-[var(--app-border)]'
                          }`}
                        >
                          {mode === 'self' ? 'My wallet' : mode === 'lp' ? 'Auto LP' : mode === 'burn' ? 'Burn' : 'Custom'}
                        </button>
                      ))}
                    </div>
                    {config.taxRecipientMode === 'custom' && (
                      <input
                        type="text"
                        value={config.customTaxRecipient}
                        onChange={e => update('customTaxRecipient', e.target.value)}
                        placeholder="oct..."
                        className="w-full mt-2 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:border-[var(--app-blue)] transition-colors"
                      />
                    )}
                  </div>

                  {config.autoBurn && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-xs text-yellow-300">
                      ⚠️ Combined fees: tax ({config.taxBps} bps) + auto-burn ({config.autoBurnBps} bps) = {(parseInt(config.taxBps, 10) + parseInt(config.autoBurnBps, 10)) / 100}% (max 25%)
                    </div>
                  )}
                </>
              )}

              {!config.tax && (
                <div className="text-center text-sm text-[var(--app-muted)] py-8">
                  Trading tax is disabled. No fees will be charged on transfers.
                </div>
              )}

              {step3Errors.length > 0 && (
                <div className="text-xs text-[var(--app-danger)] space-y-1">
                  {step3Errors.map((e, i) => <div key={i}>• {e}</div>)}
                </div>
              )}
            </div>
          )}

          {/* ====== Step 4: Summary ====== */}
          {wizardStep === 4 && (
            <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6 space-y-5">
              <h3 className="text-sm font-semibold">4. Summary</h3>

              <div className="space-y-2 text-sm">
                <SummaryRow label="Token Name" value={config.name.trim() || '—'} />
                <SummaryRow label="Symbol" value={config.symbol.trim().toUpperCase() || '—'} />
                <SummaryRow label="Contract Name" value={config.contractName.trim() || '—'} />
                <SummaryRow label="Decimals" value={String(config.decimals)} />
                <SummaryRow label="Initial Supply" value={config.initialSupply ? parseInt(config.initialSupply, 10).toLocaleString() : '—'} />
                <SummaryRow label="Supply Recipient" value={config.supplyRecipientMode === 'self' ? 'My wallet' : config.customSupplyRecipient} />
                <SummaryRow label="Token Owner" value={config.tokenOwnerMode === 'self' ? 'My wallet' : config.customTokenOwner} />
              </div>

              <div className="border-t border-[var(--app-border)] pt-3">
                <div className="text-xs font-semibold mb-2 text-[var(--app-muted)]">Features</div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {config.mintable && <Feature enabled>✓ Mintable</Feature>}
                  {config.burnable && <Feature enabled>✓ Burnable</Feature>}
                  {config.pausable && <Feature enabled>✓ Pausable</Feature>}
                  {config.blacklist && <Feature enabled>✓ Blacklist</Feature>}
                  {config.maxTx && <Feature enabled>✓ Max Tx ({config.maxTxAmount})</Feature>}
                  {config.maxWallet && <Feature enabled>✓ Max Wallet ({config.maxWalletAmount})</Feature>}
                  {config.cooldown && <Feature enabled>✓ Cooldown ({config.cooldownSeconds}s)</Feature>}
                  {config.autoBurn && <Feature enabled>✓ Auto-burn ({config.autoBurnBps} bps)</Feature>}
                  {config.tax && <Feature enabled>✓ Tax ({config.taxBps} bps)</Feature>}
                  {config.reflection && <Feature enabled>✓ Reflection</Feature>}
                  {!config.mintable && !config.burnable && !config.pausable && !config.blacklist &&
                   !config.maxTx && !config.maxWallet && !config.cooldown && !config.autoBurn &&
                   !config.tax && !config.reflection && (
                    <div className="col-span-2 text-[var(--app-muted-2)] italic">No optional features</div>
                  )}
                </div>
              </div>

              <div className="border-t border-[var(--app-border)] pt-3 space-y-2 text-sm">
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
                  <span className={`font-mono ${walletBalance && Number(walletBalance) / 1e6 < parseFloat(estimatedCost) ? 'text-[var(--app-danger)]' : ''}`}>
                    {walletBalance ? `${(Number(walletBalance) / 1_000_000).toFixed(4)} OCT` : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--app-muted)]">Wallet</span>
                  <span className="text-xs truncate max-w-[200px]">{walletService.address || 'Not connected'}</span>
                </div>
              </div>
            </div>
          )}

          {/* ====== Navigation buttons ====== */}
          <div className="flex gap-3">
            {wizardStep > 1 && (
              <button
                onClick={goBack}
                className="px-6 py-3 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl text-sm font-medium transition-colors"
              >
                ← Back
              </button>
            )}
            {wizardStep < 4 && (
              <button
                onClick={goNext}
                disabled={
                  (wizardStep === 1 && !step1Valid) ||
                  (wizardStep === 2 && !step2Valid) ||
                  (wizardStep === 3 && !step3Valid)
                }
                className="flex-1 py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:from-[var(--app-muted-2)] disabled:to-[var(--app-muted-2)] rounded-xl font-medium transition-all"
              >
                Save & Next →
              </button>
            )}
            {wizardStep === 4 && (
              <button
                onClick={() => {
                  if (!isConnected) { connect(); return; }
                  handleLaunch();
                }}
                disabled={!canLaunch}
                className="flex-1 py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:from-[var(--app-muted-2)] disabled:to-[var(--app-muted-2)] rounded-xl font-medium transition-all"
              >
                {!isConnected ? 'Connect Wallet' : 'Deploy Token 🚀'}
              </button>
            )}
          </div>

          {step.type === 'error' && (
            <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-4 py-3">
              {step.message}
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

              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-2">
                <div className="text-xs text-[var(--app-muted)]">Token Address</div>
                <div className="font-mono text-sm break-all bg-[var(--app-hover)] rounded-lg px-3 py-2 select-all">
                  {step.tokenAddress}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => navigator.clipboard.writeText(step.tokenAddress)}
                  className="py-3 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl text-sm font-medium transition-colors"
                >
                  Copy Address
                </button>
                <a
                  href={`${EXPLORER_URL}/address/${step.tokenAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-3 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl text-sm font-medium transition-colors flex items-center justify-center"
                >
                  View Contract
                </a>
                <button
                  onClick={() => navigate(`/pool`)}
                  className="py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] rounded-xl text-sm font-medium transition-colors"
                >
                  Create Pool
                </button>
                <button
                  onClick={reset}
                  className="py-3 bg-[var(--app-hover)] rounded-xl text-sm font-medium transition-colors"
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

// ========== Helper sub-components ==========
function FeatureCard({ title, desc, enabled, onToggle, children }: {
  title: string;
  desc: string;
  enabled: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={`p-3 rounded-xl border-2 transition-colors ${
      enabled ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/5' : 'border-[var(--app-border)] bg-[var(--app-panel-soft)]'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{title}</div>
          <div className="text-[10px] text-[var(--app-muted)] mt-0.5">{desc}</div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
            enabled ? 'bg-[var(--app-blue)]' : 'bg-[var(--app-muted-2)]'
          }`}
        >
          <div className={`w-4 h-4 bg-white rounded-full transition-transform mt-0.5 ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
        </button>
      </div>
      {enabled && children && (
        <div className="mt-3 pt-3 border-t border-[var(--app-border)]">
          {children}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[var(--app-muted)]">{label}</span>
      <span className="font-mono text-xs truncate ml-2 max-w-[200px]">{value}</span>
    </div>
  );
}

function Feature({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  return (
    <div className={enabled ? 'text-green-400' : 'text-[var(--app-muted-2)]'}>
      {children}
    </div>
  );
}

export default LaunchTokenPage;
