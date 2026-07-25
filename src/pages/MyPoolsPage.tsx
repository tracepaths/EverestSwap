import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { CONTRACTS } from '../config';

interface MyPool {
  address: string;
  tokenA: string;
  tokenB: string;
  symbolA: string;
  symbolB: string;
  reserveA: string;
  reserveB: string;
  totalLp: string;
  active: boolean;
  owner: string;
  feeNum: number;
  feeDenom: number;
}

type RemoveStep =
  | { type: 'idle' }
  | { type: 'pending' }
  | { type: 'done'; pool: string }
  | { type: 'error'; message: string };

function formatAddress(a: string) {
  if (!a || a.length < 14) return a;
  return `${a.slice(0, 10)}...${a.slice(-6)}`;
}

function ReserveIndicator({ value, label }: { value: string; label: string }) {
  const empty = Number(value) === 0 || value === '0' || value === '';
  return (
    <div className="bg-[var(--app-panel-soft)] rounded-xl p-3 text-center border border-[var(--app-border-soft)]">
      <div className="text-[10px] text-[var(--app-muted)] uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-mono text-sm font-bold ${empty ? 'text-green-400' : 'text-[var(--app-text)]'}`}>
        {empty ? '0 ✓' : value}
      </div>
      {empty && <div className="text-[10px] text-green-400/60 mt-0.5">drained</div>}
    </div>
  );
}

export default function MyPoolsPage() {
  const { rpc, isConnected, walletAddress, addToast, connect } = useApp();

  const [myPools, setMyPools] = useState<MyPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [removeStep, setRemoveStep] = useState<RemoveStep>({ type: 'idle' });
  const [selectedPool, setSelectedPool] = useState<MyPool | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const loadMyPools = useCallback(async () => {
    if (!isConnected || !walletAddress) return;
    setLoading(true);
    try {
      const allAddrs: string[] = await rpc.getAllPools(CONTRACTS.factory).catch(() => []);
      const details = await Promise.all(
        allAddrs.map(async (addr) => {
          try {
            const [tokenA, tokenB, reserveData, active, owner, feeNum, feeDenom] = await Promise.all([
              rpc.contractView<string>(addr, 'get_token_a', []).catch(() => ''),
              rpc.contractView<string>(addr, 'get_token_b', []).catch(() => ''),
              rpc.getReserves(addr).catch(() => ({ reserveA: '0', reserveB: '0' })),
              rpc.contractView<boolean>(addr, 'active', []).catch(() => true),
              rpc.contractView<string>(addr, 'owner', []).catch(() => ''),
              rpc.contractView<number>(addr, 'fee_numerator', []).catch(() => 3),
              rpc.contractView<number>(addr, 'fee_denominator', []).catch(() => 1000),
            ]);

            // Filter: only pools owned by current user
            if (!owner || owner.toLowerCase() !== walletAddress.toLowerCase()) return null;

            let symbolA = '', symbolB = '';
            try { symbolA = await rpc.contractView<string>(tokenA, 'symbol', []).catch(() => tokenA.slice(0, 6)); } catch { symbolA = '???'; }
            try { symbolB = await rpc.contractView<string>(tokenB, 'symbol', []).catch(() => tokenB.slice(0, 6)); } catch { symbolB = '???'; }

            const totalLp = await rpc.contractView<string>(addr, 'total_lp', []).catch(() => '0');

            return {
              address: addr,
              tokenA,
              tokenB,
              symbolA,
              symbolB,
              reserveA: reserveData.reserveA,
              reserveB: reserveData.reserveB,
              totalLp: String(totalLp ?? '0'),
              active: Boolean(active),
              owner: owner,
              feeNum: Number(feeNum) || 3,
              feeDenom: Number(feeDenom) || 1000,
            } as MyPool;
          } catch {
            return null;
          }
        })
      );
      setMyPools(details.filter((p): p is MyPool => p !== null));
    } catch (err) {
      console.error('Failed to load my pools:', err);
      addToast('error', 'Failed to load your pools');
    } finally {
      setLoading(false);
    }
  }, [rpc, isConnected, walletAddress, addToast]);

  useEffect(() => {
    loadMyPools();
  }, [loadMyPools]);

  const isPoolRemovable = (p: MyPool) => {
    const emptyA = Number(p.reserveA) === 0 || p.reserveA === '0' || p.reserveA === '';
    const emptyB = Number(p.reserveB) === 0 || p.reserveB === '0' || p.reserveB === '';
    const emptyLp = Number(p.totalLp) === 0 || p.totalLp === '0' || p.totalLp === '';
    return emptyA && emptyB && emptyLp;
  };

  const handleRemovePool = async () => {
    if (!selectedPool) return;
    if (confirmText.toLowerCase() !== 'remove') {
      addToast('error', 'Please type REMOVE to confirm');
      return;
    }
    setRemoveStep({ type: 'pending' });
    try {
      const hash = await walletService.callContract({
        contract: CONTRACTS.factory,
        method: 'remove_pool',
        params: [selectedPool.address],
        rpc,
      });
      await rpc.waitForReceipt(hash);
      setRemoveStep({ type: 'done', pool: selectedPool.address });
      setShowConfirm(false);
      setSelectedPool(null);
      setConfirmText('');
      addToast('success', `Pool ${selectedPool.address.slice(0,10)}... removed from factory`);
      await loadMyPools();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remove failed';
      setRemoveStep({ type: 'error', message: msg });
      addToast('error', `Remove failed: ${msg}`);
    }
  };

  return (
    <div className="mx-auto max-w-3xl w-full space-y-6 pb-16 pt-2 px-2">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl border border-[var(--app-border)] p-6 shadow-xl">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-indigo-400 uppercase tracking-wider mb-1">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              Pool Creator Dashboard
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">My Pools</h1>
            <p className="text-sm text-[var(--app-muted)] mt-1">
              Manage, drain, and remove liquidity pools you created.
            </p>
          </div>
          <button
            onClick={loadMyPools}
            disabled={loading || !isConnected}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white text-sm font-semibold rounded-xl transition-all disabled:opacity-40"
          >
            {loading ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>
        </div>
      </div>

      {/* Not Connected */}
      {!isConnected && (
        <div className="text-center bg-[var(--app-panel)] rounded-2xl border border-[var(--app-border)] p-12 space-y-4">
          <div className="text-5xl">🔌</div>
          <h2 className="text-xl font-bold text-[var(--app-text)]">Connect Your Wallet</h2>
          <p className="text-sm text-[var(--app-muted)]">Connect your wallet to view pools you created.</p>
          <button
            onClick={connect}
            className="px-6 py-2.5 bg-[var(--app-blue)] hover:bg-[var(--app-blue-hover)] text-white font-bold rounded-xl transition-all"
          >
            Connect Wallet
          </button>
        </div>
      )}

      {/* Info Banner */}
      {isConnected && (
        <div className="bg-amber-950/30 border border-amber-700/40 rounded-xl p-4 flex gap-3 items-start text-sm">
          <span className="text-amber-400 text-lg shrink-0">ℹ️</span>
          <div className="text-amber-200/70">
            <strong className="text-amber-300">How to Remove a Pool:</strong> A pool can only be removed after all liquidity positions have been withdrawn (zero reserves &amp; zero LP). First, ensure all LPs have removed their liquidity, then use the Remove button.
          </div>
        </div>
      )}

      {/* Pools List */}
      {isConnected && (
        <div className="space-y-4">
          {loading && myPools.length === 0 && (
            <div className="flex justify-center items-center py-12 text-[var(--app-muted)]">
              <svg className="w-6 h-6 animate-spin mr-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Loading your pools…
            </div>
          )}

          {!loading && myPools.length === 0 && (
            <div className="text-center bg-[var(--app-panel)] rounded-2xl border border-[var(--app-border)] p-12 space-y-3">
              <div className="text-5xl">🌊</div>
              <h3 className="text-lg font-bold text-[var(--app-text)]">No Pools Found</h3>
              <p className="text-sm text-[var(--app-muted)]">
                You haven't created any liquidity pools yet, or they were already removed.
              </p>
            </div>
          )}

          {myPools.map((pool) => {
            const removable = isPoolRemovable(pool);
            return (
              <div
                key={pool.address}
                className="bg-[var(--app-panel)] rounded-2xl border border-[var(--app-border)] overflow-hidden hover:border-[var(--app-blue-3)]/40 transition-all"
              >
                {/* Pool Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--app-border-soft)]">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 border-2 border-[var(--app-panel)] flex items-center justify-center text-xs font-bold text-white">
                        {pool.symbolA.slice(0, 1)}
                      </div>
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 border-2 border-[var(--app-panel)] flex items-center justify-center text-xs font-bold text-white">
                        {pool.symbolB.slice(0, 1)}
                      </div>
                    </div>
                    <div>
                      <div className="font-bold text-[var(--app-text)]">{pool.symbolA} / {pool.symbolB}</div>
                      <div className="text-xs text-[var(--app-muted)] font-mono">{formatAddress(pool.address)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      pool.active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {pool.active ? 'Active' : 'Paused'}
                    </span>
                    <span className="text-xs text-[var(--app-muted)] bg-[var(--app-panel-soft)] px-2 py-0.5 rounded-lg">
                      Fee: {((pool.feeNum / pool.feeDenom) * 100).toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* Pool Details */}
                <div className="px-5 py-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <ReserveIndicator value={pool.reserveA} label={`Reserve ${pool.symbolA}`} />
                    <ReserveIndicator value={pool.reserveB} label={`Reserve ${pool.symbolB}`} />
                    <div className="bg-[var(--app-panel-soft)] rounded-xl p-3 text-center border border-[var(--app-border-soft)]">
                      <div className="text-[10px] text-[var(--app-muted)] uppercase tracking-wider mb-1">Total LP</div>
                      <div className={`font-mono text-sm font-bold ${
                        Number(pool.totalLp) === 0 ? 'text-green-400' : 'text-[var(--app-text)]'
                      }`}>
                        {Number(pool.totalLp) === 0 ? '0 ✓' : pool.totalLp}
                      </div>
                      {Number(pool.totalLp) === 0 && <div className="text-[10px] text-green-400/60 mt-0.5">no positions</div>}
                    </div>
                  </div>

                  {/* Remove Pool Button */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="text-xs text-[var(--app-muted)]">
                      {removable ? (
                        <span className="text-green-400 flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          Pool is empty — safe to remove
                        </span>
                      ) : (
                        <span className="text-yellow-400/80 flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          Drain all liquidity first to enable removal
                        </span>
                      )}
                    </div>
                    <button
                      disabled={!removable}
                      onClick={() => {
                        setSelectedPool(pool);
                        setShowConfirm(true);
                        setConfirmText('');
                        setRemoveStep({ type: 'idle' });
                      }}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                        removable
                          ? 'bg-red-600/90 hover:bg-red-600 text-white cursor-pointer shadow-lg shadow-red-900/30'
                          : 'bg-[var(--app-panel-soft)] text-[var(--app-muted)] cursor-not-allowed opacity-50'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Remove Pool
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Remove Confirmation Modal */}
      {showConfirm && selectedPool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[var(--app-panel)] border border-red-900/60 rounded-2xl w-full max-w-md shadow-2xl shadow-black/50">
            {/* Modal Header */}
            <div className="flex items-center gap-3 px-6 py-5 border-b border-[var(--app-border-soft)]">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-[var(--app-text)]">Remove Pool</h3>
                <p className="text-xs text-[var(--app-muted)]">Deregister from SwapFactory — irreversible</p>
              </div>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-5 space-y-4">
              <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-[var(--app-muted)]">Pool</span>
                  <span className="font-mono text-[var(--app-text)] text-xs">{formatAddress(selectedPool.address)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--app-muted)]">Pair</span>
                  <span className="font-bold text-[var(--app-text)]">{selectedPool.symbolA} / {selectedPool.symbolB}</span>
                </div>
              </div>

              <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-3 text-xs text-red-200/70 leading-relaxed">
                ⚠️ This action permanently removes the pool from the factory routing. The pool contract remains on-chain but cannot be used for swaps. This cannot be undone.
              </div>

              <div className="space-y-2">
                <label className="text-xs text-[var(--app-muted)] font-medium">
                  Type <span className="font-mono font-bold text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">REMOVE</span> to confirm:
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type REMOVE here…"
                  className="w-full bg-[var(--app-input)] border border-[var(--app-border)] text-[var(--app-text)] rounded-xl px-4 py-2.5 text-sm outline-none focus:border-red-500/60 transition-colors"
                />
              </div>

              {removeStep.type === 'error' && (
                <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3">
                  {removeStep.message}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 px-6 pb-6">
              <button
                onClick={() => {
                  setShowConfirm(false);
                  setSelectedPool(null);
                  setConfirmText('');
                  setRemoveStep({ type: 'idle' });
                }}
                disabled={removeStep.type === 'pending'}
                className="flex-1 px-4 py-2.5 bg-[var(--app-panel-soft)] hover:bg-[var(--app-hover)] text-[var(--app-text)] font-semibold rounded-xl transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRemovePool}
                disabled={confirmText.toLowerCase() !== 'remove' || removeStep.type === 'pending'}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {removeStep.type === 'pending' ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Removing…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Remove Pool
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
