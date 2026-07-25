import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { CONTRACTS } from '../config';
import { StatCard, Section, InputGroup, Button, ConfirmModal } from '../components/admin';
import { isValidOctraAddress } from '../services/octraRpc';

type AdminTab = 'overview' | 'factory' | 'router' | 'pools' | 'tokens';

interface PoolAdminInfo {
  address: string;
  tokenA: string;
  tokenB: string;
  reserveA: string;
  reserveB: string;
  active: boolean;
  owner: string;
  feeNum: number;
  feeDenom: number;
}

export default function AdminPage() {
  const { rpc, isConnected, walletAddress, addToast, connect } = useApp();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // Anti-indexing meta tag enforcement
  useEffect(() => {
    let metaRobots = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    let created = false;
    if (!metaRobots) {
      metaRobots = document.createElement('meta');
      metaRobots.name = 'robots';
      created = true;
      document.head.appendChild(metaRobots);
    }
    const previousContent = metaRobots.content;
    metaRobots.content = 'noindex, nofollow, noarchive, nosnippet';

    return () => {
      if (metaRobots) {
        if (created) {
          metaRobots.remove();
        } else {
          metaRobots.content = previousContent;
        }
      }
    };
  }, []);

  // State: Overview & Contract Roles
  const [factoryFeeTo, setFactoryFeeTo] = useState('');
  const [factoryFeeSetter, setFactoryFeeSetter] = useState('');
  const [factoryPendingSetter, setFactoryPendingSetter] = useState('');
  const [factoryPaused, setFactoryPaused] = useState(false);
  const [factoryPoolCount, setFactoryPoolCount] = useState<number>(0);
  const [trustedTokensCount, setTrustedTokensCount] = useState<number>(0);

  const [routerOwner, setRouterOwner] = useState('');
  const [routerPendingOwner, setRouterPendingOwner] = useState('');
  const [routerPaused, setRouterPaused] = useState(false);
  const [routerMaxSlippageBps, setRouterMaxSlippageBps] = useState<number>(1000);

  const [loadingStats, setLoadingStats] = useState(true);

  // Form Inputs: Factory Actions
  const [inputFeeTo, setInputFeeTo] = useState('');
  const [inputNewSetter, setInputNewSetter] = useState('');
  const [inputTrustedToken, setInputTrustedToken] = useState('');
  const [inputUntrustedToken, setInputUntrustedToken] = useState('');

  // Form Inputs: Router Actions
  const [inputRouterPendingOwner, setInputRouterPendingOwner] = useState('');
  const [inputMaxSlippageBps, setInputMaxSlippageBps] = useState('1000');
  const [inputProposedFactory, setInputProposedFactory] = useState('');
  const [inputProposedWoct, setInputProposedWoct] = useState('');

  // Pools Management
  const [poolsList, setPoolsList] = useState<PoolAdminInfo[]>([]);
  const [selectedPoolAddr, setSelectedPoolAddr] = useState('');
  const [inputPoolFeeNum, setInputPoolFeeNum] = useState('3');
  const [inputPoolFeeDenom, setInputPoolFeeDenom] = useState('1000');
  const [inputPoolNewOwner, setInputPoolNewOwner] = useState('');

  // Token Controls
  const [inputTokenAddr, setInputTokenAddr] = useState('');
  const [inputTargetUser, setInputTargetUser] = useState('');
  const [inputMintAmount, setInputMintAmount] = useState('');

  // Modal State
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => Promise<void>;
    confirmText?: string;
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: async () => {},
  });
  const [actionBusy, setActionBusy] = useState(false);

  // Load Overview Data
  const loadOverview = useCallback(async () => {
    setLoadingStats(true);
    try {
      // Factory state queries
      const [feeTo, feeSetter, pendingSetter, paused, poolCount, trustedList] = await Promise.all([
        rpc.contractView<string>(CONTRACTS.factory, 'fee_to', []).catch(() => 'Error'),
        rpc.contractView<string>(CONTRACTS.factory, 'fee_to_setter', []).catch(() => 'Error'),
        rpc.contractView<string>(CONTRACTS.factory, 'pending_setter', []).catch(() => ''),
        rpc.contractView<boolean>(CONTRACTS.factory, 'paused', []).catch(() => false),
        rpc.contractView<number>(CONTRACTS.factory, 'pool_count', []).catch(() => 0),
        rpc.getTrustedTokens(CONTRACTS.factory).catch(() => []),
      ]);

      setFactoryFeeTo(feeTo || '');
      setFactoryFeeSetter(feeSetter || '');
      setFactoryPendingSetter(pendingSetter || '');
      setFactoryPaused(Boolean(paused));
      setFactoryPoolCount(Number(poolCount) || 0);
      setTrustedTokensCount(trustedList.length);

      // Router state queries
      const [rOwner, rPendingOwner, rPaused, rMaxSlippage] = await Promise.all([
        rpc.contractView<string>(CONTRACTS.router, 'owner', []).catch(() => 'Error'),
        rpc.contractView<string>(CONTRACTS.router, 'pending_owner', []).catch(() => ''),
        rpc.contractView<boolean>(CONTRACTS.router, 'paused', []).catch(() => false),
        rpc.contractView<number>(CONTRACTS.router, 'max_slippage_bps', []).catch(() => 1000),
      ]);

      setRouterOwner(rOwner || '');
      setRouterPendingOwner(rPendingOwner || '');
      setRouterPaused(Boolean(rPaused));
      setRouterMaxSlippageBps(Number(rMaxSlippage) || 1000);
    } catch (err) {
      console.error('Failed to load admin overview:', err);
    } finally {
      setLoadingStats(false);
    }
  }, [rpc]);

  // Load Pools Data
  const loadPools = useCallback(async () => {
    try {
      const poolAddrs = await rpc.getAllPools(CONTRACTS.factory);
      const poolDetails = await Promise.all(
        poolAddrs.map(async (addr) => {
          try {
            const [tokenA, tokenB, reserves, active, owner, feeNum, feeDenom] = await Promise.all([
              rpc.contractView<string>(addr, 'get_token_a', []).catch(() => ''),
              rpc.contractView<string>(addr, 'get_token_b', []).catch(() => ''),
              rpc.getReserves(addr).catch(() => ({ reserveA: '0', reserveB: '0' })),
              rpc.contractView<boolean>(addr, 'active', []).catch(() => true),
              rpc.contractView<string>(addr, 'owner', []).catch(() => ''),
              rpc.contractView<number>(addr, 'fee_numerator', []).catch(() => 3),
              rpc.contractView<number>(addr, 'fee_denominator', []).catch(() => 1000),
            ]);

            return {
              address: addr,
              tokenA,
              tokenB,
              reserveA: reserves.reserveA,
              reserveB: reserves.reserveB,
              active: Boolean(active),
              owner: owner || '',
              feeNum: Number(feeNum) || 3,
              feeDenom: Number(feeDenom) || 1000,
            };
          } catch {
            return null;
          }
        })
      );
      setPoolsList(poolDetails.filter((p): p is PoolAdminInfo => p !== null));
    } catch (err) {
      console.error('Failed to load pools:', err);
    }
  }, [rpc]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (activeTab === 'pools') {
      loadPools();
    }
  }, [activeTab, loadPools]);

  // Execute Tx Helper
  const promptConfirm = (title: string, message: string, action: () => Promise<void>, confirmText = 'Execute') => {
    setModalConfig({
      isOpen: true,
      title,
      message,
      action,
      confirmText,
    });
  };

  const handleModalConfirm = async () => {
    setActionBusy(true);
    try {
      await modalConfig.action();
      addToast('success', 'Admin transaction submitted & confirmed successfully');
      setModalConfig(prev => ({ ...prev, isOpen: false }));
      loadOverview();
      if (activeTab === 'pools') loadPools();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      addToast('error', `Execution error: ${msg}`);
    } finally {
      setActionBusy(false);
    }
  };

  const isSetter = isConnected && walletAddress.toLowerCase() === factoryFeeSetter.toLowerCase();
  const isRouterOwner = isConnected && walletAddress.toLowerCase() === routerOwner.toLowerCase();

  return (
    <div className="admin-page mx-auto w-full max-w-6xl space-y-6 pb-12 pt-2">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-2xl border border-[var(--app-border)] p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--app-blue-3)] uppercase tracking-wider mb-1">
              <span className="w-2 h-2 rounded-full bg-[var(--app-success)] animate-pulse" />
              AMM DEX Administration Panel
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Contract Management</h1>
            <p className="text-sm text-[var(--app-muted)] mt-1">
              Control protocol fees, governance roles, token trust registry, and emergency security parameters.
            </p>
          </div>
          <div className="flex items-center gap-3 bg-[var(--app-panel-soft)] px-4 py-2.5 rounded-xl border border-[var(--app-border)]">
            <span className="text-xs text-[var(--app-muted)]">Active Admin Wallet:</span>
            {isConnected ? (
              <span className="text-xs font-mono font-bold text-[var(--app-text)]">
                {walletAddress.slice(0, 8)}...{walletAddress.slice(-6)}
              </span>
            ) : (
              <button
                onClick={connect}
                className="text-xs font-bold text-[var(--app-blue-3)] hover:underline"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-[var(--app-border)] pb-2 overflow-x-auto">
        {(
          [
            { key: 'overview', label: 'Overview & Roles' },
            { key: 'factory', label: 'Factory Controls' },
            { key: 'router', label: 'Router Controls' },
            { key: 'pools', label: 'Pools Management' },
            { key: 'tokens', label: 'Token Governance' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === t.key
                ? 'bg-[var(--app-blue)] text-white shadow-lg'
                : 'text-[var(--app-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Factory Pools"
              value={factoryPoolCount}
              subtitle="Registered AMM trading pairs"
              isLoading={loadingStats}
            />
            <StatCard
              title="Trusted Tokens"
              value={trustedTokensCount}
              subtitle="Verified tokens in registry"
              isLoading={loadingStats}
            />
            <StatCard
              title="Factory Status"
              value={factoryPaused ? 'PAUSED' : 'ACTIVE'}
              subtitle={factoryPaused ? 'Swaps & registrations blocked' : 'Operating normally'}
              error={factoryPaused}
              isLoading={loadingStats}
            />
            <StatCard
              title="Router Max Slippage"
              value={`${(routerMaxSlippageBps / 100).toFixed(2)}%`}
              subtitle={`Limit: ${routerMaxSlippageBps} BPS`}
              isLoading={loadingStats}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Section title="Factory Roles & Authorization" subtitle="Fee recipient and governance setter">
              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between items-center p-3 rounded-lg bg-[var(--app-panel-soft)] border border-[var(--app-border)]">
                  <span className="text-[var(--app-muted)]">fee_to_setter (Admin):</span>
                  <span className="font-bold text-[var(--app-text)] truncate max-w-[220px]">{factoryFeeSetter || 'None'}</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-[var(--app-panel-soft)] border border-[var(--app-border)]">
                  <span className="text-[var(--app-muted)]">fee_to (Recipient):</span>
                  <span className="font-bold text-[var(--app-text)] truncate max-w-[220px]">{factoryFeeTo || 'None'}</span>
                </div>
                {factoryPendingSetter && (
                  <div className="flex justify-between items-center p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
                    <span>pending_setter:</span>
                    <span className="font-bold truncate max-w-[220px]">{factoryPendingSetter}</span>
                  </div>
                )}
                <div className="pt-2 text-[11px] text-[var(--app-muted)]">
                  {isSetter ? (
                    <span className="text-[var(--app-success)] font-semibold">✓ Connected wallet is the active Factory Setter</span>
                  ) : (
                    <span>⚠️ Connected wallet is NOT the Factory Setter</span>
                  )}
                </div>
              </div>
            </Section>

            <Section title="Router Roles & Controls" subtitle="Execution router owner and security state">
              <div className="space-y-3 font-mono text-xs">
                <div className="flex justify-between items-center p-3 rounded-lg bg-[var(--app-panel-soft)] border border-[var(--app-border)]">
                  <span className="text-[var(--app-muted)]">Router Owner:</span>
                  <span className="font-bold text-[var(--app-text)] truncate max-w-[220px]">{routerOwner || 'None'}</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-lg bg-[var(--app-panel-soft)] border border-[var(--app-border)]">
                  <span className="text-[var(--app-muted)]">Router Paused:</span>
                  <span className={`font-bold ${routerPaused ? 'text-[var(--app-danger)]' : 'text-[var(--app-success)]'}`}>
                    {routerPaused ? 'YES' : 'NO'}
                  </span>
                </div>
                {routerPendingOwner && (
                  <div className="flex justify-between items-center p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
                    <span>pending_owner:</span>
                    <span className="font-bold truncate max-w-[220px]">{routerPendingOwner}</span>
                  </div>
                )}
                <div className="pt-2 text-[11px] text-[var(--app-muted)]">
                  {isRouterOwner ? (
                    <span className="text-[var(--app-success)] font-semibold">✓ Connected wallet is the Router Owner</span>
                  ) : (
                    <span>⚠️ Connected wallet is NOT the Router Owner</span>
                  )}
                </div>
              </div>
            </Section>
          </div>
        </div>
      )}

      {/* Factory Controls Tab */}
      {activeTab === 'factory' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Section title="Emergency Pause / Resume" subtitle="Halt or resume all factory operations">
            <div className="space-y-4">
              <p className="text-xs text-[var(--app-muted)]">
                Pausing the factory stops new pool registrations and global factory-level operations in an emergency.
              </p>
              <div className="flex gap-3">
                <Button
                  label="Pause Factory"
                  variant="danger"
                  disabled={!isSetter || factoryPaused}
                  onClick={() =>
                    promptConfirm('Pause SwapFactory', 'Are you sure you want to pause all factory operations?', async () => {
                      const hash = await walletService.callContract({
                        contract: CONTRACTS.factory,
                        method: 'set_paused',
                        params: [true],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
                <Button
                  label="Resume Factory"
                  variant="success"
                  disabled={!isSetter || !factoryPaused}
                  onClick={() =>
                    promptConfirm('Resume SwapFactory', 'Resume normal factory operations?', async () => {
                      const hash = await walletService.callContract({
                        contract: CONTRACTS.factory,
                        method: 'set_paused',
                        params: [false],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
              </div>
            </div>
          </Section>

          <Section title="Set Protocol Fee Recipient" subtitle="Update fee_to address receiving protocol fees">
            <div className="space-y-4">
              <InputGroup
                label="New fee_to:"
                value={inputFeeTo}
                onChange={setInputFeeTo}
                placeholder="oct..."
              />
              <Button
                label="Update Fee Recipient"
                variant="primary"
                disabled={!isSetter || !isValidOctraAddress(inputFeeTo)}
                onClick={() =>
                  promptConfirm('Update fee_to Recipient', `Set protocol fee recipient to ${inputFeeTo}?`, async () => {
                    const hash = await walletService.callContract({
                      contract: CONTRACTS.factory,
                      method: 'set_fee_to',
                      params: [inputFeeTo],
                      rpc,
                    });
                    await rpc.waitForReceipt(hash);
                    setInputFeeTo('');
                  })
                }
              />
            </div>
          </Section>

          <Section title="Initiate Setter Transfer (2-Step)" subtitle="Propose a new fee_to_setter with 24h timelock">
            <div className="space-y-4">
              <InputGroup
                label="New Setter:"
                value={inputNewSetter}
                onChange={setInputNewSetter}
                placeholder="oct..."
              />
              <Button
                label="Propose New Setter"
                variant="primary"
                disabled={!isSetter || !isValidOctraAddress(inputNewSetter)}
                onClick={() =>
                  promptConfirm('Initiate Setter Transfer', `Propose ${inputNewSetter} as new fee_to_setter (24h timelock)?`, async () => {
                    const hash = await walletService.callContract({
                      contract: CONTRACTS.factory,
                      method: 'initiate_setter_transfer',
                      params: [inputNewSetter],
                      rpc,
                    });
                    await rpc.waitForReceipt(hash);
                    setInputNewSetter('');
                  })
                }
              />
            </div>
          </Section>

          <Section title="Accept Setter Transfer" subtitle="Claim pending setter role after timelock">
            <div className="space-y-4">
              <p className="text-xs text-[var(--app-muted)]">
                Pending Setter: <span className="font-mono text-[var(--app-text)]">{factoryPendingSetter || 'None'}</span>
              </p>
              <Button
                label="Accept Setter Role"
                variant="success"
                disabled={!isConnected || !factoryPendingSetter || walletAddress.toLowerCase() !== factoryPendingSetter.toLowerCase()}
                onClick={() =>
                  promptConfirm('Accept Setter Role', 'Claim fee_to_setter role on SwapFactory?', async () => {
                    const hash = await walletService.callContract({
                      contract: CONTRACTS.factory,
                      method: 'accept_setter_transfer',
                      params: [],
                      rpc,
                    });
                    await rpc.waitForReceipt(hash);
                  })
                }
              />
            </div>
          </Section>
        </div>
      )}

      {/* Router Controls Tab */}
      {activeTab === 'router' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Section title="Router Pause Control" subtitle="Emergency pause for swap router">
            <div className="space-y-4">
              <div className="flex gap-3">
                <Button
                  label="Pause Router"
                  variant="danger"
                  disabled={!isRouterOwner || routerPaused}
                  onClick={() =>
                    promptConfirm('Pause Router', 'Halt all routing functions on the Router contract?', async () => {
                      const hash = await walletService.callContract({
                        contract: CONTRACTS.router,
                        method: 'set_paused',
                        params: [true],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
                <Button
                  label="Resume Router"
                  variant="success"
                  disabled={!isRouterOwner || !routerPaused}
                  onClick={() =>
                    promptConfirm('Resume Router', 'Resume routing functions on the Router contract?', async () => {
                      const hash = await walletService.callContract({
                        contract: CONTRACTS.router,
                        method: 'set_paused',
                        params: [false],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
              </div>
            </div>
          </Section>

          <Section title="Set Global Max Slippage" subtitle="Enforce maximum slippage tolerance (BPS)">
            <div className="space-y-4">
              <InputGroup
                label="Max Slippage (BPS):"
                value={inputMaxSlippageBps}
                onChange={setInputMaxSlippageBps}
                placeholder="1000 (10%)"
                type="number"
              />
              <Button
                label="Update Max Slippage"
                variant="primary"
                disabled={!isRouterOwner || !inputMaxSlippageBps || Number(inputMaxSlippageBps) <= 0}
                onClick={() =>
                  promptConfirm('Set Max Slippage', `Set Router maximum slippage to ${inputMaxSlippageBps} BPS (${(Number(inputMaxSlippageBps)/100).toFixed(2)}%)?`, async () => {
                    const hash = await walletService.callContract({
                      contract: CONTRACTS.router,
                      method: 'set_max_slippage_bps',
                      params: [Number(inputMaxSlippageBps)],
                      rpc,
                    });
                    await rpc.waitForReceipt(hash);
                  })
                }
              />
            </div>
          </Section>

          <Section title="Propose Router Ownership Transfer" subtitle="Propose a new Router owner (2-step)">
            <div className="space-y-4">
              <InputGroup
                label="New Owner:"
                value={inputRouterPendingOwner}
                onChange={setInputRouterPendingOwner}
                placeholder="oct..."
              />
              <Button
                label="Propose Ownership Transfer"
                variant="primary"
                disabled={!isRouterOwner || !isValidOctraAddress(inputRouterPendingOwner)}
                onClick={() =>
                  promptConfirm('Transfer Router Ownership', `Propose ${inputRouterPendingOwner} as new Router owner?`, async () => {
                    const hash = await walletService.callContract({
                      contract: CONTRACTS.router,
                      method: 'transfer_ownership',
                      params: [inputRouterPendingOwner],
                      rpc,
                    });
                    await rpc.waitForReceipt(hash);
                    setInputRouterPendingOwner('');
                  })
                }
              />
            </div>
          </Section>

          <Section title="Accept Router Ownership" subtitle="Claim pending Router ownership">
            <div className="space-y-4">
              <p className="text-xs text-[var(--app-muted)]">
                Pending Router Owner: <span className="font-mono text-[var(--app-text)]">{routerPendingOwner || 'None'}</span>
              </p>
              <Button
                label="Accept Router Ownership"
                variant="success"
                disabled={!isConnected || !routerPendingOwner || walletAddress.toLowerCase() !== routerPendingOwner.toLowerCase()}
                onClick={() =>
                  promptConfirm('Accept Ownership', 'Claim ownership of the Router contract?', async () => {
                    const hash = await walletService.callContract({
                      contract: CONTRACTS.router,
                      method: 'accept_ownership',
                      params: [],
                      rpc,
                    });
                    await rpc.waitForReceipt(hash);
                  })
                }
              />
            </div>
          </Section>

          <Section title="Propose Factory Address Update" subtitle="Update target Factory on Router (24h timelock)">
            <div className="space-y-4">
              <InputGroup
                label="New Factory:"
                value={inputProposedFactory}
                onChange={setInputProposedFactory}
                placeholder="oct..."
              />
              <div className="flex gap-3">
                <Button
                  label="Propose Factory"
                  variant="primary"
                  disabled={!isRouterOwner || !isValidOctraAddress(inputProposedFactory)}
                  onClick={() =>
                    promptConfirm('Propose Factory', `Propose ${inputProposedFactory} on Router?`, async () => {
                      const hash = await walletService.callContract({
                        contract: CONTRACTS.router,
                        method: 'propose_factory',
                        params: [inputProposedFactory],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                      setInputProposedFactory('');
                    })
                  }
                />
                <Button
                  label="Accept Factory"
                  variant="success"
                  disabled={!isRouterOwner}
                  onClick={() =>
                    promptConfirm('Accept Factory', 'Accept pending factory on Router after timelock?', async () => {
                      const hash = await walletService.callContract({
                        contract: CONTRACTS.router,
                        method: 'accept_factory',
                        params: [],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
              </div>
            </div>
          </Section>

          <Section title="Propose WOCT Address Update" subtitle="Update target WOCT on Router (24h timelock)">
            <div className="space-y-4">
              <InputGroup
                label="New WOCT:"
                value={inputProposedWoct}
                onChange={setInputProposedWoct}
                placeholder="oct..."
              />
              <div className="flex gap-3">
                <Button
                  label="Propose WOCT"
                  variant="primary"
                  disabled={!isRouterOwner || !isValidOctraAddress(inputProposedWoct)}
                  onClick={() =>
                    promptConfirm('Propose WOCT', `Propose ${inputProposedWoct} on Router?`, async () => {
                      const hash = await walletService.callContract({
                        contract: CONTRACTS.router,
                        method: 'propose_woct',
                        params: [inputProposedWoct],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                      setInputProposedWoct('');
                    })
                  }
                />
                <Button
                  label="Accept WOCT"
                  variant="success"
                  disabled={!isRouterOwner}
                  onClick={() =>
                    promptConfirm('Accept WOCT', 'Accept pending WOCT on Router after timelock?', async () => {
                      const hash = await walletService.callContract({
                        contract: CONTRACTS.router,
                        method: 'accept_woct',
                        params: [],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
              </div>
            </div>
          </Section>
        </div>
      )}

      {/* Pools Management Tab */}
      {activeTab === 'pools' && (
        <div className="space-y-6">
          <Section title="Registered Liquidity Pools" subtitle="Configure pool fee parameters and emergency status">
            <div className="overflow-x-auto border border-[var(--app-border)] rounded-xl">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="bg-[var(--app-panel-soft)] border-b border-[var(--app-border)] text-[var(--app-muted)]">
                    <th className="p-3">Pool Address</th>
                    <th className="p-3">Token Pair</th>
                    <th className="p-3">Reserves</th>
                    <th className="p-3">Fee Rate</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--app-border-soft)]">
                  {poolsList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-[var(--app-muted)]">
                        No liquidity pools found
                      </td>
                    </tr>
                  ) : (
                    poolsList.map((p) => (
                      <tr key={p.address} className="hover:bg-[var(--app-hover)]">
                        <td className="p-3 font-bold text-[var(--app-blue-3)]">{p.address.slice(0, 10)}...</td>
                        <td className="p-3">{p.tokenA.slice(0, 6)}... / {p.tokenB.slice(0, 6)}...</td>
                        <td className="p-3">{p.reserveA} / {p.reserveB}</td>
                        <td className="p-3">{((p.feeNum / p.feeDenom) * 100).toFixed(2)}%</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${p.active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                            {p.active ? 'Active' : 'Paused'}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => setSelectedPoolAddr(p.address)}
                            className="px-2.5 py-1 bg-[var(--app-blue)] text-white rounded hover:opacity-80 transition-opacity"
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          {selectedPoolAddr && (
            <Section title={`Manage Pool: ${selectedPoolAddr}`} subtitle="Configure specific pool parameters">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-[var(--app-text)]">Update Pool Fee Ratio</h4>
                  <div className="flex gap-3">
                    <InputGroup label="Numerator:" value={inputPoolFeeNum} onChange={setInputPoolFeeNum} type="number" />
                    <InputGroup label="Denominator:" value={inputPoolFeeDenom} onChange={setInputPoolFeeDenom} type="number" />
                  </div>
                  <Button
                    label="Update Fee Params"
                    variant="primary"
                    onClick={() =>
                      promptConfirm('Update Pool Fee', `Set fee to ${inputPoolFeeNum}/${inputPoolFeeDenom} for pool ${selectedPoolAddr}?`, async () => {
                        const hash = await walletService.callContract({
                          contract: selectedPoolAddr,
                          method: 'set_fee_params',
                          params: [Number(inputPoolFeeNum), Number(inputPoolFeeDenom)],
                          rpc,
                        });
                        await rpc.waitForReceipt(hash);
                      })
                    }
                  />
                </div>

                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-[var(--app-text)]">Emergency Pool Actions</h4>
                  <div className="flex gap-3">
                    <Button
                      label="Pause Pool"
                      variant="danger"
                      onClick={() =>
                        promptConfirm('Pause Pool', `Set pool ${selectedPoolAddr} active state to FALSE?`, async () => {
                          const hash = await walletService.callContract({
                            contract: selectedPoolAddr,
                            method: 'set_active',
                            params: [false],
                            rpc,
                          });
                          await rpc.waitForReceipt(hash);
                        })
                      }
                    />
                    <Button
                      label="Activate Pool"
                      variant="success"
                      onClick={() =>
                        promptConfirm('Activate Pool', `Set pool ${selectedPoolAddr} active state to TRUE?`, async () => {
                          const hash = await walletService.callContract({
                            contract: selectedPoolAddr,
                            method: 'set_active',
                            params: [true],
                            rpc,
                          });
                          await rpc.waitForReceipt(hash);
                        })
                      }
                    />
                  </div>

                  <div className="pt-2">
                    <InputGroup
                      label="New Owner:"
                      value={inputPoolNewOwner}
                      onChange={setInputPoolNewOwner}
                      placeholder="oct..."
                    />
                    <Button
                      label="Transfer Pool Ownership"
                      variant="secondary"
                      className="mt-3"
                      disabled={!isValidOctraAddress(inputPoolNewOwner)}
                      onClick={() =>
                        promptConfirm('Transfer Pool Ownership', `Propose ${inputPoolNewOwner} as owner of pool ${selectedPoolAddr}?`, async () => {
                          const hash = await walletService.callContract({
                            contract: selectedPoolAddr,
                            method: 'propose_owner',
                            params: [inputPoolNewOwner],
                            rpc,
                          });
                          await rpc.waitForReceipt(hash);
                          setInputPoolNewOwner('');
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </Section>
          )}
        </div>
      )}

      {/* Token Governance Tab */}
      {activeTab === 'tokens' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Section title="Add Trusted Token" subtitle="Add token to SwapFactory trusted registry">
            <div className="space-y-4">
              <InputGroup
                label="Token Address:"
                value={inputTrustedToken}
                onChange={setInputTrustedToken}
                placeholder="oct..."
              />
              <Button
                label="Add to Trusted Registry"
                variant="primary"
                disabled={!isSetter || !isValidOctraAddress(inputTrustedToken)}
                onClick={() =>
                  promptConfirm('Add Trusted Token', `Add ${inputTrustedToken} to trusted registry?`, async () => {
                    const hash = await walletService.callContract({
                      contract: CONTRACTS.factory,
                      method: 'add_trusted_token',
                      params: [inputTrustedToken],
                      rpc,
                    });
                    await rpc.waitForReceipt(hash);
                    setInputTrustedToken('');
                  })
                }
              />
            </div>
          </Section>

          <Section title="Remove Trusted Token" subtitle="Remove token from SwapFactory trusted registry">
            <div className="space-y-4">
              <InputGroup
                label="Token Address:"
                value={inputUntrustedToken}
                onChange={setInputUntrustedToken}
                placeholder="oct..."
              />
              <Button
                label="Remove from Trusted Registry"
                variant="danger"
                disabled={!isSetter || !isValidOctraAddress(inputUntrustedToken)}
                onClick={() =>
                  promptConfirm('Remove Trusted Token', `Remove ${inputUntrustedToken} from trusted registry?`, async () => {
                    const hash = await walletService.callContract({
                      contract: CONTRACTS.factory,
                      method: 'remove_trusted_token',
                      params: [inputUntrustedToken],
                      rpc,
                    });
                    await rpc.waitForReceipt(hash);
                    setInputUntrustedToken('');
                  })
                }
              />
            </div>
          </Section>

          <Section title="Token Contract Controls" subtitle="Manage individual OCS01 token state (Pause, Blacklist, Mint)">
            <div className="space-y-4">
              <InputGroup
                label="Token Contract:"
                value={inputTokenAddr}
                onChange={setInputTokenAddr}
                placeholder="oct..."
              />
              <InputGroup
                label="Target User:"
                value={inputTargetUser}
                onChange={setInputTargetUser}
                placeholder="oct... (for blacklist/mint)"
              />

              <div className="grid grid-cols-2 gap-3 pt-2">
                <Button
                  label="Pause Token"
                  variant="danger"
                  disabled={!isValidOctraAddress(inputTokenAddr)}
                  onClick={() =>
                    promptConfirm('Pause Token', `Pause transfers on token ${inputTokenAddr}?`, async () => {
                      const hash = await walletService.callContract({
                        contract: inputTokenAddr,
                        method: 'set_paused',
                        params: [true],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
                <Button
                  label="Unpause Token"
                  variant="success"
                  disabled={!isValidOctraAddress(inputTokenAddr)}
                  onClick={() =>
                    promptConfirm('Unpause Token', `Unpause transfers on token ${inputTokenAddr}?`, async () => {
                      const hash = await walletService.callContract({
                        contract: inputTokenAddr,
                        method: 'set_paused',
                        params: [false],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Button
                  label="Blacklist User"
                  variant="danger"
                  disabled={!isValidOctraAddress(inputTokenAddr) || !isValidOctraAddress(inputTargetUser)}
                  onClick={() =>
                    promptConfirm('Blacklist User', `Blacklist user ${inputTargetUser} on token ${inputTokenAddr}?`, async () => {
                      const hash = await walletService.callContract({
                        contract: inputTokenAddr,
                        method: 'set_blacklisted',
                        params: [inputTargetUser, true],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
                <Button
                  label="Unblacklist User"
                  variant="secondary"
                  disabled={!isValidOctraAddress(inputTokenAddr) || !isValidOctraAddress(inputTargetUser)}
                  onClick={() =>
                    promptConfirm('Unblacklist User', `Remove blacklist for user ${inputTargetUser} on token ${inputTokenAddr}?`, async () => {
                      const hash = await walletService.callContract({
                        contract: inputTokenAddr,
                        method: 'set_blacklisted',
                        params: [inputTargetUser, false],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
              </div>

              <div className="border-t border-[var(--app-border)] pt-4 space-y-3">
                <InputGroup
                  label="Mint Amount:"
                  value={inputMintAmount}
                  onChange={setInputMintAmount}
                  placeholder="Raw units (e.g. 1000000)"
                  type="number"
                />
                <Button
                  label="Mint Tokens"
                  variant="primary"
                  disabled={!isValidOctraAddress(inputTokenAddr) || !isValidOctraAddress(inputTargetUser) || !inputMintAmount}
                  onClick={() =>
                    promptConfirm('Mint Tokens', `Mint ${inputMintAmount} units of ${inputTokenAddr} to ${inputTargetUser}?`, async () => {
                      const hash = await walletService.callContract({
                        contract: inputTokenAddr,
                        method: 'mint',
                        params: [inputTargetUser, inputMintAmount],
                        rpc,
                      });
                      await rpc.waitForReceipt(hash);
                    })
                  }
                />
              </div>
            </div>
          </Section>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={modalConfig.isOpen}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        isLoading={actionBusy}
        onConfirm={handleModalConfirm}
        onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
