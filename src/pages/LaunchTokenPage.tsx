import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { sanitizeNumericInput } from '../services/swapService';
import type { TokenLaunchConfig } from '../types';
import { EXPLORER_URL, CONTRACTS, WOCT_TOKEN } from '../config';
import { cookieStorage } from '../services/cookieStorage';
import LoadingModal from '../components/LoadingModal';

type LaunchStep =
  | { type: 'idle' }
  | { type: 'compiling' }
  | { type: 'computing_address' }
  | { type: 'granting_woct' }
  | { type: 'launching' }
  | { type: 'done'; tokenAddress: string; poolAddress: string }
  | { type: 'error'; message: string };

type WizardStep = 1 | 2 | 3 | 4;

const INITIAL_CONFIG: TokenLaunchConfig = {
  name: '',
  symbol: '',
  contractName: '',
  initialSupply: '',
  decimals: 6,
  supplyRecipientMode: 'self',
  customSupplyRecipient: '',
  tokenOwnerMode: 'self',
  customTokenOwner: '',
  trusted1: '',
  trusted2: '',
  trusted3: '',
  trusted4: '',
  trusted5: '',
  mintable: false,
  burnable: false,
  pausable: false,
  blacklist: false,
  maxTx: false,
  maxTxAmount: '0',
  maxWallet: false,
  maxWalletAmount: '0',
  cooldown: false,
  cooldownSeconds: '10',
  autoBurn: false,
  autoBurnBps: '100',
  tax: false,
  taxBps: '100',
  taxRecipientMode: 'self',
  customTaxRecipient: '',
  // Liquidity amounts for factory.launch()
  liqTokenAmount: '',
  liqWoctAmount: '',
};

function toBigInt(s: string, decimals: number): bigint | null {
  if (!s || !/^\d+$/.test(s)) return null;
  try {
    const v = BigInt(s);
    if (v <= 0n) return null;
    return v * BigInt(10) ** BigInt(decimals);
  } catch {
    return null;
  }
}

import { isValidOctraAddress } from '../services/octraRpc';
function isValidAddress(addr: string): boolean {
  return isValidOctraAddress(addr);
}

function LaunchTokenPage() {
  const { rpc, isConnected, network, connect, walletBalance, refreshBalance } = useApp();
  const navigate = useNavigate();
  const [config, setConfig] = useState<TokenLaunchConfig>(INITIAL_CONFIG);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [step, setStep] = useState<LaunchStep>({ type: 'idle' });
  const mountedRef = useRef(true);
  const launchingRef = useRef(false);
  const configLoadedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (configLoadedRef.current) return;
    configLoadedRef.current = true;
    const saved = cookieStorage.loadLaunchConfig();
    if (saved?.config) {
      setConfig(saved.config);
      setWizardStep(saved.wizardStep);
    }
  }, []);

  useEffect(() => {
    if (!configLoadedRef.current) return;
    const handler = setTimeout(() => {
      cookieStorage.saveLaunchConfig(config, wizardStep);
    }, 300);
    return () => clearTimeout(handler);
  }, [config, wizardStep]);

  useEffect(() => {
    if (!config.contractName && config.name.trim()) {
      const auto = config.name.trim().replace(/[^a-zA-Z0-9]/g, '') + 'Token';
      setConfig(c => ({ ...c, contractName: auto }));
    }
  }, [config.name, config.contractName]);

  const step1Errors = useMemo(() => {
    const errs: string[] = [];
    if (!config.name.trim()) errs.push('Token name is required');
    else if (config.name.trim().length > 50) errs.push('Name must be 50 characters or less');
    else if (!/^[\p{L}\p{N} _.,'-]+$/u.test(config.name.trim())) errs.push('Name contains invalid characters');

    if (!config.symbol.trim()) errs.push('Token symbol is required');
    else if (config.symbol.trim().length > 20) errs.push('Symbol must be 20 characters or less');
    else if (!/^[a-zA-Z0-9 _-]+$/.test(config.symbol.trim())) errs.push('Symbol contains invalid characters');

    if (config.decimals < 1 || config.decimals > 18) errs.push('Decimals must be 1-18');

    if (!config.initialSupply.trim() || !/^\d+$/.test(config.initialSupply.trim())) {
      errs.push('Initial supply must be a positive integer');
    } else {
      const v = BigInt(config.initialSupply.trim());
      if (v <= 0n) errs.push('Initial supply must be positive');
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
    if (config.maxTx && (!config.maxTxAmount || BigInt(config.maxTxAmount || '0') <= 0n)) {
      errs.push('Max transaction amount must be > 0');
    }
    if (config.maxWallet && (!config.maxWalletAmount || BigInt(config.maxWalletAmount || '0') <= 0n)) {
      errs.push('Max wallet amount must be > 0');
    }
    if (config.cooldown) {
      const cd = parseInt(config.cooldownSeconds, 10);
      if (isNaN(cd) || cd < 1 || cd > 1000) errs.push('Cooldown must be 1-1000 blocks');
    }
    if (config.autoBurn) {
      const bps = parseInt(config.autoBurnBps, 10);
      if (isNaN(bps) || bps < 1 || bps > 1000) errs.push('Auto-burn must be 1-1000 bps (0.01%-10%)');
    }
    if (config.maxWallet) {
      const trusted = [config.trusted1, config.trusted2, config.trusted3, config.trusted4, config.trusted5]
        .map(t => t.trim()).filter(t => t !== '');
      const seen = new Set<string>();
      for (const t of trusted) {
        if (seen.has(t)) {
          errs.push(`Duplicate trusted address: ${t.slice(0, 10)}...`);
          break;
        }
        seen.add(t);
      }
      for (let i = 0; i < trusted.length; i++) {
        if (!isValidAddress(trusted[i])) {
          errs.push(`Trusted #${i + 1} is not a valid Octra address`);
        }
      }
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

  // Liquidity validation for Step 4
  const liqErrors = useMemo(() => {
    const errs: string[] = [];
    if (!config.liqTokenAmount.trim() || !/^\d+$/.test(config.liqTokenAmount.trim())) {
      errs.push('Token liquidity amount is required');
    } else {
      const v = BigInt(config.liqTokenAmount.trim());
      if (v <= 0n) errs.push('Token liquidity amount must be positive');
    }
    if (!config.liqWoctAmount.trim() || !/^\d+$/.test(config.liqWoctAmount.trim())) {
      errs.push('WOCT liquidity amount is required');
    } else {
      const v = parseFloat(config.liqWoctAmount.trim());
      if (!Number.isFinite(v) || v <= 0) errs.push('WOCT liquidity amount must be positive');
    }
    // Check liqToken <= initialSupply
    if (config.liqTokenAmount.trim() && config.initialSupply.trim()) {
      const liqTokenRaw = toBigInt(config.liqTokenAmount, config.decimals);
      const initialSupplyRaw = toBigInt(config.initialSupply, config.decimals);
      if (liqTokenRaw && initialSupplyRaw && liqTokenRaw > initialSupplyRaw) {
        errs.push('Token liquidity cannot exceed initial supply');
      }
    }
    return errs;
  }, [config]);

  const step1Valid = step1Errors.length === 0;
  const step2Valid = step2Errors.length === 0;
  const step3Valid = step3Errors.length === 0;

  const allErrors = [...step1Errors, ...step2Errors, ...step3Errors, ...liqErrors];
  const canLaunch = isConnected && allErrors.length === 0 && (step.type === 'idle' || step.type === 'error');

  const [estimatedCost, setEstimatedCost] = useState('0.2000');

  const handleLaunch = async () => {
    if (!canLaunch) return;
    if (launchingRef.current) return;
    launchingRef.current = true;
    const walletSnap = walletService.address;
    if (!walletSnap) {
      setStep({ type: 'error', message: 'Wallet not connected' });
      launchingRef.current = false;
      return;
    }

    try {
      setStep({ type: 'compiling' });

      const sourceResp = await fetch('/contracts/Token.aml');
      if (!sourceResp.ok) throw new Error('Failed to load Token.aml source');
      const source = await sourceResp.text();

      const compileResult = await rpc.compileAml(source);
      const tokenBytecode = compileResult.bytecode;
      const instructions = Number(compileResult.instructions || 0);
      const baseGas = Math.ceil(instructions * 1.2);
      const dynamicCostOCT = (baseGas / 1_000_000).toFixed(4);
      setEstimatedCost(dynamicCostOCT);

      setStep({ type: 'computing_address' });

      if (walletService.address !== walletSnap) {
        throw new Error('Wallet changed during launch — aborting');
      }
      const balance = await rpc.call<{ balance: string; nonce: number }>('octra_balance', [walletSnap]);
      if (walletService.address !== walletSnap) {
        throw new Error('Wallet changed during launch — aborting');
      }
      const deployNonce = balance.nonce + 1;

      const addrResult = await rpc.computeContractAddress(tokenBytecode, walletSnap, deployNonce);
      const tokenAddress = addrResult.address;

      // --- Single-tx factory.launch() flow ---
      const factoryAddr = CONTRACTS.factory;
      if (!factoryAddr) throw new Error('Factory contract not configured');
      const woctAddr = WOCT_TOKEN.address;

      // Pre-approve factory on WOCT (factory pulls WOCT for liquidity)
      setStep({ type: 'granting_woct' });
      const woctRaw = BigInt(Math.round(parseFloat(config.liqWoctAmount) * 1_000_000)).toString();
      const grantHash = await walletService.callContract({
        contract: woctAddr,
        method: 'grant',
        params: [factoryAddr, woctRaw],
        rpc,
      });
      // [FIX] Wait for the grant to actually land on chain before submitting
      // factory.launch(), which pulls WOCT. A 500 ms setTimeout was a race —
      // launch would revert on missing allowance whenever the chain lagged.
      await rpc.waitForReceipt(grantHash, 120);

      // Get current epoch for deadline
      const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
      const currentEpoch = epochInfo.epoch_id || 0;
      const deadline = currentEpoch + 300;

      // Build the 35-param launch message as an array (not JSON string)
      const maxTxAmount = config.maxTx ? BigInt(config.maxTxAmount || '0') * BigInt(10) ** BigInt(config.decimals) : 0n;
      const maxWalletAmount = config.maxWallet ? BigInt(config.maxWalletAmount || '0') * BigInt(10) ** BigInt(config.decimals) : 0n;
      const liqToken = toBigInt(config.liqTokenAmount, config.decimals) || 0n;
      const liqWoct = BigInt(Math.round(parseFloat(config.liqWoctAmount) * 1_000_000));
      const minLp = 1;
      const lockDuration = 0;
      const feeNum = 3;
      const feeDen = 1000;
      const maxRatio = 0;

      setStep({ type: 'launching' });

      const launchHash = await walletService.callContract({
        contract: factoryAddr,
        method: 'launch',
        params: [
          config.name.trim(),
          config.symbol.trim().toUpperCase(),
          config.contractName.trim() || (config.name.trim() + 'Token'),
          toBigInt(config.initialSupply, config.decimals)?.toString() || '0',
          String(config.decimals),
          walletSnap,       // initial_owner = caller (forced)
          factoryAddr,      // supply_recipient = factory (forced)
          maxTxAmount.toString(),
          maxWalletAmount.toString(),
          String(config.cooldown ? parseInt(config.cooldownSeconds, 10) : 0),
          String(config.tax ? parseInt(config.taxBps, 10) : 0),
          config.taxRecipientMode === 'custom' ? config.customTaxRecipient.trim() : walletSnap,
          String(config.autoBurn ? parseInt(config.autoBurnBps, 10) : 0),
          config.mintable,
          config.burnable,
          config.pausable,
          config.blacklist,
          config.maxTx,
          config.maxWallet,
          config.cooldown,
          config.tax,
          config.autoBurn,
          (config.trusted1 || '').trim(),
          (config.trusted2 || '').trim(),
          (config.trusted3 || '').trim(),
          (config.trusted4 || '').trim(),
          (config.trusted5 || '').trim(),
          feeNum,
          feeDen,
          maxRatio,
          liqToken.toString(),
          liqWoct.toString(),
          minLp,
          deadline,
          lockDuration,
        ],
        // [V12] launch() spawns TWO contracts (Token + SwapPool) and seeds
        // liquidity — the heaviest call in the app. Send a generous ou so the
        // effort budget is never the limiting factor.
        ou: '600000',
        rpc,
      });

      await rpc.waitForReceipt(launchHash, 120);

      // Read pool address from factory
      // [FIX] Previously called `get_pool_by_index` which is NOT a factory method.
      // Use `get_pool(tokenA, tokenB)` (factory's canonical view). For launch(),
      // the pool is always (token, WOCT).
      let poolAddress = '';
      try {
        poolAddress = await rpc.getPoolAddress(factoryAddr, tokenAddress, WOCT_TOKEN.address);
      } catch { /* pool address lookup is best-effort */ }

      if (mountedRef.current) {
        setStep({ type: 'done', tokenAddress, poolAddress });
        rpc.clearCache();
        refreshBalance().catch(() => { /* non-fatal */ });
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
      case 'granting_woct': return 'Granting WOCT allowance to factory...';
      case 'launching': return 'Launching token + pool (single tx)...';
      case 'done': return 'Token and pool launched successfully!';
      case 'error': return 'Error: ' + step.message;
      default: return '';
    }
  };

  const reset = () => {
    cookieStorage.clearLaunchConfig();
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

  const safeNumeric = (v: string): string => {
    const r = sanitizeNumericInput(v);
    return r === 'INVALID' ? '' : r;
  };

  const goBack = () => {
    if (wizardStep > 1) setWizardStep((wizardStep - 1) as WizardStep);
  };

  const fillRandom = () => {
    const names = ['MoonDoge', 'SafePEPE', 'EverCorgi', 'LazySloth', 'SpaceBunny', 'ChadFox', 'PikaPulse', 'DankMeme', 'GigaChad', 'BasedBolt', 'WagmiWhale', 'DegenDuck', 'ApeTogether', 'RizzRaccoon', 'BetBear'];
    const prefixes = ['SUPER', 'MEGA', 'ULTRA', 'HYPER', 'BIG', 'WOW', 'MOON', 'STAR', 'GOLD', 'DARK'];
    const name = names[Math.floor(Math.random() * names.length)];
    const prefixIdx = Math.floor(Math.random() * prefixes.length);
    const withPrefix = Math.random() > 0.5;
    const fullName = withPrefix ? `${prefixes[prefixIdx]} ${name}` : name;
    const symbolLen = 3 + Math.floor(Math.random() * 3);
    const symChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let symbol = '';
    for (let i = 0; i < symbolLen; i++) symbol += symChars[Math.floor(Math.random() * symChars.length)];
    const decimalsOptions = [6, 9, 18];
    const decimals = decimalsOptions[Math.floor(Math.random() * decimalsOptions.length)];
    const maxSupply = (9_223_372_036_854_775_807n / (BigInt(10) ** BigInt(decimals))).toString();
    const maxSupplyNum = Number(maxSupply);
    const supply = Math.floor(Math.random() * Math.min(maxSupplyNum, 1_000_000_000_000)) + 1_000_000;
    const randomBool = () => Math.random() > 0.6;
    const randomBps = (min: number, max: number) => String(Math.floor(Math.random() * (max - min + 1)) + min);
    const randomAmount = () => String(Math.floor(Math.random() * 100_000) + 1_000);
    setConfig({
      ...INITIAL_CONFIG,
      name: fullName,
      symbol,
      contractName: fullName.replace(/[^a-zA-Z0-9]/g, '') + 'Token',
      initialSupply: String(supply),
      decimals,
      mintable: randomBool(),
      burnable: randomBool(),
      pausable: randomBool(),
      blacklist: randomBool(),
      maxTx: randomBool(),
      maxTxAmount: randomBool() ? randomAmount() : '0',
      maxWallet: randomBool(),
      maxWalletAmount: randomBool() ? randomAmount() : '0',
      cooldown: randomBool(),
      cooldownSeconds: randomBool() ? randomBps(1, 1000) : '10',
      autoBurn: randomBool(),
      autoBurnBps: randomBool() ? randomBps(1, 1000) : '100',
      tax: randomBool(),
      taxBps: randomBool() ? randomBps(1, 2500) : '100',
      taxRecipientMode: 'self',
      liqTokenAmount: String(Math.floor(Math.random() * 100_000_000) + 1_000_000),
      liqWoctAmount: String((Math.random() * 10 + 0.1).toFixed(2)),
    });
    setWizardStep(1);
  };

  return (
    <>
    <LoadingModal
      isOpen={step.type !== 'idle' && step.type !== 'done' && step.type !== 'error'}
      title="Launching Token"
      steps={[
        { key: 'compiling', label: 'Compiling Token contract' },
        { key: 'computing_address', label: 'Computing token address' },
        { key: 'granting_woct', label: 'Granting WOCT to factory' },
        { key: 'launching', label: 'Launching token + pool' },
      ]}
      currentStep={step.type}
      error={step.type === 'error' ? step.message : undefined}
    />
      <div className="page-surface mx-auto w-full max-w-4xl pt-1 sm:pt-3 space-y-5">
      <div className="page-heading">
        <div><div className="page-kicker">Token studio</div><h1 className="page-title">Launch Token</h1><p className="page-subtitle">Configure, review, and deploy a token + pool on EverestSwap in a single transaction.</p></div>
        {(step.type === 'idle' || step.type === 'error') && (
          <button
            type="button"
            onClick={fillRandom}
            className="page-action whitespace-nowrap"
          >
            🎲 Random Fill
          </button>
        )}
      </div>

      {/* ====== Step tabs ====== */}
      {step.type === 'idle' || step.type === 'error' ? (
        <>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
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
                  className={`flex-1 py-2 px-3 rounded-xl border-2 text-base font-medium transition-colors ${
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
            <div className="page-panel p-4 sm:p-6 space-y-5">
              <h3 className="text-sm font-semibold">1. General</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--app-muted)]">Token Name <span className="text-red-400">*</span></label>
                  <input type="text" value={config.name} onChange={e => update('name', e.target.value)} placeholder="My Awesome Token" maxLength={50} className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors" />
                  <div className="text-[10px] text-[var(--app-muted-2)] text-right">{config.name.length}/50</div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--app-muted)]">Token Symbol <span className="text-red-400">*</span></label>
                  <input type="text" value={config.symbol} onChange={e => update('symbol', e.target.value)} placeholder="MAT" maxLength={20} className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors uppercase" />
                  <div className="text-[10px] text-[var(--app-muted-2)] text-right">{config.symbol.length}/20</div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--app-muted)]">Contract Name</label>
                <input type="text" value={config.contractName} onChange={e => update('contractName', e.target.value)} placeholder="MyAwesomeToken" maxLength={50} className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors" />
                <p className="text-[10px] text-[var(--app-muted-2)]">Used for verification. Auto-derived from token name if left empty.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--app-muted)]">Initial Supply <span className="text-red-400">*</span></label>
                  <input type="text" value={config.initialSupply} onChange={e => update('initialSupply', safeNumeric(e.target.value))} placeholder="1000000" className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[var(--app-blue)] transition-colors" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--app-muted)]">Decimals</label>
                  <div className="flex gap-2">
                    {[6, 9, 18].map(d => (
                      <button key={d} type="button" onClick={() => update('decimals', d)} className={`flex-1 py-2 rounded-xl border-2 text-sm font-medium transition-colors ${config.decimals === d ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10 text-[var(--app-blue-3)]' : 'border-[var(--app-border)] text-[var(--app-muted)] hover:border-[var(--app-muted-2)]'}`}>{d}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--app-muted)]">Supply Recipient</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => update('supplyRecipientMode', 'self')} className={`py-2 rounded-xl border-2 text-sm font-medium ${config.supplyRecipientMode === 'self' ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10' : 'border-[var(--app-border)]'}`}>My wallet</button>
                  <button type="button" onClick={() => update('supplyRecipientMode', 'custom')} className={`py-2 rounded-xl border-2 text-sm font-medium ${config.supplyRecipientMode === 'custom' ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10' : 'border-[var(--app-border)]'}`}>Different address</button>
                </div>
                {config.supplyRecipientMode === 'custom' && (
                  <input type="text" value={config.customSupplyRecipient} onChange={e => update('customSupplyRecipient', e.target.value)} placeholder="oct..." className="w-full mt-2 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:border-[var(--app-blue)] transition-colors" />
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-[var(--app-muted)]">Token Owner</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => update('tokenOwnerMode', 'self')} className={`py-2 rounded-xl border-2 text-sm font-medium ${config.tokenOwnerMode === 'self' ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10' : 'border-[var(--app-border)]'}`}>My wallet</button>
                  <button type="button" onClick={() => update('tokenOwnerMode', 'custom')} className={`py-2 rounded-xl border-2 text-sm font-medium ${config.tokenOwnerMode === 'custom' ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10' : 'border-[var(--app-border)]'}`}>Different address</button>
                </div>
                {config.tokenOwnerMode === 'custom' && (
                  <input type="text" value={config.customTokenOwner} onChange={e => update('customTokenOwner', e.target.value)} placeholder="oct..." className="w-full mt-2 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:border-[var(--app-blue)] transition-colors" />
                )}
                <p className="text-[10px] text-[var(--app-muted-2)]">Owner can manage token features (mint, burn, pause, etc.)</p>
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
                <FeatureCard title="Mintable" desc="Owner can mint new tokens after launch (uncapped)" enabled={config.mintable} onToggle={() => update('mintable', !config.mintable)} />
                <FeatureCard title="Burnable" desc="Holders can burn their tokens" enabled={config.burnable} onToggle={() => update('burnable', !config.burnable)} />
                <FeatureCard title="Pausable" desc="Owner can pause all transfers" enabled={config.pausable} onToggle={() => update('pausable', !config.pausable)} />
                <FeatureCard title="Blacklist" desc="Owner can blacklist addresses" enabled={config.blacklist} onToggle={() => update('blacklist', !config.blacklist)} />
                <FeatureCard title="Max Transaction" desc="Cap on transfer size (anti-bot)" enabled={config.maxTx} onToggle={() => update('maxTx', !config.maxTx)}>
                  <label className="text-[10px] text-[var(--app-muted-2)]">Max tx amount (tokens)</label>
                  <input type="text" value={config.maxTxAmount} onChange={e => update('maxTxAmount', safeNumeric(e.target.value))} placeholder="10000" disabled={!config.maxTx} className="w-full mt-1 bg-[var(--app-bg)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)] disabled:opacity-50" />
                </FeatureCard>
                <FeatureCard title="Max Wallet" desc="Cap on wallet size (anti-whale). Add trusted addresses to bypass." enabled={config.maxWallet} onToggle={() => update('maxWallet', !config.maxWallet)}>
                  <label className="text-[10px] text-[var(--app-muted-2)]">Max wallet amount (tokens)</label>
                  <input type="text" value={config.maxWalletAmount} onChange={e => update('maxWalletAmount', safeNumeric(e.target.value))} placeholder="50000" disabled={!config.maxWallet} className="w-full mt-1 bg-[var(--app-bg)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)] disabled:opacity-50" />
                  <label className="text-[10px] text-[var(--app-muted-2)] mt-2 block">Trusted addresses (bypass max wallet, max 5)</label>
                  {[1, 2, 3, 4, 5].map(i => {
                    const key = `trusted${i}` as 'trusted1' | 'trusted2' | 'trusted3' | 'trusted4' | 'trusted5';
                    return (
                      <input key={i} type="text" value={config[key]} onChange={e => update(key, e.target.value)} placeholder={`oct... (optional #${i})`} disabled={!config.maxWallet} className="w-full mt-1 bg-[var(--app-bg)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-[var(--app-blue)] disabled:opacity-50" />
                    );
                  })}
                </FeatureCard>
                <FeatureCard title="Cooldown" desc="Wait time between txs per address" enabled={config.cooldown} onToggle={() => update('cooldown', !config.cooldown)}>
                  <label className="text-[10px] text-[var(--app-muted-2)]">Cooldown (blocks, 1-1000)</label>
                  <input type="number" value={config.cooldownSeconds} onChange={e => update('cooldownSeconds', e.target.value)} placeholder="60" min={1} max={86400} disabled={!config.cooldown} className="w-full mt-1 bg-[var(--app-bg)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)] disabled:opacity-50" />
                </FeatureCard>
                <FeatureCard title="Auto-burn" desc="Burn % of every transfer (deflationary)" enabled={config.autoBurn} onToggle={() => update('autoBurn', !config.autoBurn)}>
                  <label className="text-[10px] text-[var(--app-muted-2)]">Auto-burn (bps, 1-1000)</label>
                  <input type="number" value={config.autoBurnBps} onChange={e => update('autoBurnBps', e.target.value)} placeholder="100" min={1} max={1000} disabled={!config.autoBurn} className="w-full mt-1 bg-[var(--app-bg)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm outline-none focus:border-[var(--app-blue)] disabled:opacity-50" />
                  <p className="text-[10px] text-[var(--app-muted-2)] mt-1">100 bps = 1% burned per transfer</p>
                </FeatureCard>
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
                <div><div className="font-medium text-sm">Trading Tax</div><div className="text-xs text-[var(--app-muted)] mt-0.5">Charge a fee on every transfer</div></div>
                <button type="button" onClick={() => update('tax', !config.tax)} className={`w-12 h-6 rounded-full transition-colors ${config.tax ? 'bg-[var(--app-blue)]' : 'bg-[var(--app-muted-2)]'}`}>
                  <div className={`w-5 h-5 bg-white rounded-full transition-transform ${config.tax ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </button>
              </div>
              {config.tax && (
                <>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs"><span className="text-[var(--app-muted)]">Tax Rate</span><span className="font-mono font-medium">{(parseInt(config.taxBps, 10) / 100).toFixed(2)}%</span></div>
                    <input type="range" min={1} max={2500} step={10} value={config.taxBps} onChange={e => update('taxBps', e.target.value)} className="w-full" />
                    <div className="flex justify-between text-[10px] text-[var(--app-muted-2)]"><span>0.01%</span><span>25% (max)</span></div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--app-muted)]">Tax Recipient</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['self', 'burn', 'custom'] as const).map(mode => (
                        <button key={mode} type="button" onClick={() => update('taxRecipientMode', mode)} className={`py-2 rounded-xl border-2 text-xs font-medium ${config.taxRecipientMode === mode ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/10' : 'border-[var(--app-border)]'}`}>{mode === 'self' ? 'My wallet' : mode === 'burn' ? 'Burn' : 'Custom'}</button>
                      ))}
                    </div>
                    {config.taxRecipientMode === 'custom' && (
                      <input type="text" value={config.customTaxRecipient} onChange={e => update('customTaxRecipient', e.target.value)} placeholder="oct..." className="w-full mt-2 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl px-4 py-2.5 text-sm font-mono outline-none focus:border-[var(--app-blue)] transition-colors" />
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
                <div className="text-center text-sm text-[var(--app-muted)] py-8">Trading tax is disabled. No fees will be charged on transfers.</div>
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
                {config.maxWallet && [config.trusted1, config.trusted2, config.trusted3, config.trusted4, config.trusted5].filter(t => t && t.trim() !== '').length > 0 && (
                  <SummaryRow label="Trusted Addresses" value={[config.trusted1, config.trusted2, config.trusted3, config.trusted4, config.trusted5].filter(t => t && t.trim() !== '').length.toString()} />
                )}
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
                  {config.cooldown && <Feature enabled>✓ Cooldown ({config.cooldownSeconds} blocks)</Feature>}
                  {config.autoBurn && <Feature enabled>✓ Auto-burn ({config.autoBurnBps} bps)</Feature>}
                  {config.tax && <Feature enabled>✓ Tax ({config.taxBps} bps)</Feature>}
                  {!config.mintable && !config.burnable && !config.pausable && !config.blacklist && !config.maxTx && !config.maxWallet && !config.cooldown && !config.autoBurn && !config.tax && (
                    <div className="col-span-2 text-[var(--app-muted-2)] italic">No optional features</div>
                  )}
                </div>
              </div>
              <div className="border-t border-[var(--app-border)] pt-3 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[var(--app-muted)]">Network</span><span>{network === 'devnet' ? 'Devnet' : 'Mainnet'}</span></div>
                <div className="flex justify-between"><span className="text-[var(--app-muted)]">Estimated Cost</span><span className="font-mono">~{estimatedCost} OCT</span></div>
                <div className="flex justify-between"><span className="text-[var(--app-muted)]">Wallet Balance</span><span className={`font-mono ${walletBalance && Number(walletBalance) < parseFloat(estimatedCost) ? 'text-[var(--app-danger)]' : ''}`}>{walletBalance ? `${Number(walletBalance).toFixed(4)} OCT` : '—'}</span></div>
                <div className="flex justify-between"><span className="text-[var(--app-muted)]">Wallet</span><span className="text-xs truncate max-w-[200px]">{walletService.address || 'Not connected'}</span></div>
              </div>
              {/* Liquidity section */}
              <div className="border-t border-[var(--app-border)] pt-3 space-y-3">
                <h4 className="text-sm font-semibold">Initial Liquidity</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--app-muted)]">Token Amount</label>
                    <input type="text" value={config.liqTokenAmount} onChange={e => update('liqTokenAmount', safeNumeric(e.target.value))} placeholder="1000000" className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-[var(--app-blue)]" />
                    <div className="text-[10px] text-[var(--app-muted-2)]">{config.symbol.trim().toUpperCase() || 'TOKEN'}</div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--app-muted)]">WOCT Amount</label>
                    <input type="text" value={config.liqWoctAmount} onChange={e => update('liqWoctAmount', safeNumeric(e.target.value))} placeholder="1.0" className="w-full bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-[var(--app-blue)]" />
                    <div className="text-[10px] text-[var(--app-muted-2)]">WOCT</div>
                  </div>
                </div>
                {liqErrors.length > 0 && (
                  <div className="text-xs text-[var(--app-danger)] space-y-1">
                    {liqErrors.map((e, i) => <div key={i}>• {e}</div>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ====== Navigation buttons ====== */}
          <div className="flex gap-3">
            {wizardStep > 1 && (
              <button onClick={goBack} className="px-6 py-3 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl text-sm font-medium transition-colors">← Back</button>
            )}
            {wizardStep < 4 && (
              <button onClick={goNext} disabled={(wizardStep === 1 && !step1Valid) || (wizardStep === 2 && !step2Valid) || (wizardStep === 3 && !step3Valid)} className="flex-1 py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:from-[var(--app-muted-2)] disabled:to-[var(--app-muted-2)] rounded-xl font-medium transition-all">Save & Next →</button>
            )}
            {wizardStep === 4 && (
              <button
                onClick={() => { if (!isConnected) { connect(); return; } handleLaunch(); }}
                disabled={!canLaunch}
                className="flex-1 py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:from-[var(--app-muted-2)] disabled:to-[var(--app-muted-2)] rounded-xl font-medium transition-all"
              >
                {!isConnected ? 'Connect Wallet' : '🚀 Launch Token + Pool (1 tx)'}
              </button>
            )}
          </div>

          {step.type === 'error' && (
            <div className="text-xs text-[var(--app-danger)] bg-red-400/10 rounded-lg px-4 py-3">{step.message}</div>
          )}
        </>
      ) : (
        <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] p-6">
          {step.type === 'done' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-green-400">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="font-medium">{stepLabel()}</span>
              </div>
              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-2">
                <div className="text-xs text-[var(--app-muted)]">Token Address</div>
                <div className="font-mono text-sm break-all bg-[var(--app-hover)] rounded-lg px-3 py-2 select-all">{step.tokenAddress}</div>
              </div>
              {step.poolAddress && (
                <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)] space-y-2">
                  <div className="text-xs text-[var(--app-muted)]">Pool Address</div>
                  <div className="font-mono text-sm break-all bg-[var(--app-hover)] rounded-lg px-3 py-2 select-all">{step.poolAddress}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => navigator.clipboard.writeText(step.tokenAddress)} className="py-3 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl text-sm font-medium transition-colors">Copy Token Address</button>
                <a href={`${EXPLORER_URL}/address/${step.tokenAddress}`} target="_blank" rel="noopener noreferrer" className="py-3 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl text-sm font-medium transition-colors flex items-center justify-center">View Token</a>
                {step.poolAddress && (
                  <>
                    <a href={`${EXPLORER_URL}/address/${step.poolAddress}`} target="_blank" rel="noopener noreferrer" className="py-3 bg-[var(--app-panel)] hover:bg-[var(--app-hover)] border border-[var(--app-border)] rounded-xl text-sm font-medium transition-colors flex items-center justify-center">View Pool</a>
                    <button onClick={() => navigate(`/swap`)} className="py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] rounded-xl text-sm font-medium transition-colors">Start Swapping</button>
                  </>
                )}
                <button onClick={reset} className="col-span-2 py-3 bg-[var(--app-hover)] rounded-xl text-sm font-medium transition-colors">Launch Another Token</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
    </>
  );
}

function FeatureCard({ title, desc, enabled, onToggle, children }: { title: string; desc: string; enabled: boolean; onToggle: () => void; children?: React.ReactNode }) {
  return (
    <div className={`p-3 rounded-xl border-2 transition-colors ${enabled ? 'border-[var(--app-blue)] bg-[var(--app-blue)]/5' : 'border-[var(--app-border)] bg-[var(--app-panel-soft)]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0"><div className="font-medium text-sm">{title}</div><div className="text-[10px] text-[var(--app-muted)] mt-0.5">{desc}</div></div>
        <button type="button" onClick={onToggle} className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-[var(--app-blue)]' : 'bg-[var(--app-muted-2)]'}`}>
          <div className={`w-4 h-4 bg-white rounded-full transition-transform mt-0.5 ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      {enabled && children && <div className="mt-3 pt-3 border-t border-[var(--app-border)]">{children}</div>}
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
  return <div className={enabled ? 'text-green-400' : 'text-[var(--app-muted-2)]'}>{children}</div>;
}

export default LaunchTokenPage;