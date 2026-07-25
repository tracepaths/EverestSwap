import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
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
      <div className={`font-mono text-sm font-bold ${empty ? 'text-green-400' : 'text-[var(--app-text)]'}`}>{empty ? '0 ✓' : value}</div>
      {empty && <div className="text-[10px] text-green-400/60 mt-0.5">drained</div>}
    </div>
  );
}

function LiquidityPosition({
  position,
  onRemove,
}: {
  position: any;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="bg-[var(--app-panel)] rounded-xl p-4 border border-[var(--app-border)] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white">
            💰
          </div>
          <div>
            <div className="font-bold text-[var(--app-text)]">LP Position</div>
            <div className="text-xs text-[var(--app-muted)] font-mono">ID: {position.id.slice(0, 10)}...</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-[var(--app-muted)]">Value</div>
          <div className="font-mono text-sm font-bold text-[var(--app-text)]">
            {(Number(position.reserveA) + Number(position.reserveB)).toFixed(2)} tokens
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ReserveIndicator value={position.reserveA} label="Token A" />
        <ReserveIndicator value={position.reserveB} label="Token B" />
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="text-xs text-[var(--app-muted)]">
          {position.unlocked ? (
            <span className="text-green-400">Unlocked</span>
          ) : (
            <span className="text-yellow-400">Locked (in {position.lockTime} blocks)</span>
          )}
        </div>
        <button
          onClick={() => onRemove(position.id)}
          className="flex items-center gap-2 px-3 py-1.5 bg-red-600/90 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Remove
        </button>
      </div>
    </div>
  );
}

function formatTimeAgo(blocks: number) {
  if (blocks < 1440) return `${blocks} blocks ago`;
  const days = Math.floor(blocks / 1440);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export default function PoolDetailsPage() {
  const { address } = useParams<{ address: string }>();
  const { rpc, isConnected, walletAddress, addToast } = useApp();

  const [pool, setPool] = useState<MyPool | null>(null);
  const [loading, setLoading] = useState(false);
  const [positions, setPositions] = useState<any[]>([]);
  const [loadingPositions, setLoadingPositions] = useState(false);
  const [removeStep, setRemoveStep] = useState<RemoveStep>({ type: 'idle' });
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [pendingPositionRemovals, setPendingPositionRemovals] = useState<Set<string>>(new Set());

  const loadPoolDetails = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const [tokenA, tokenB, reserveData, active, owner, feeNum, feeDenom, totalLp] = await Promise.all([
        rpc.contractView<string>(address, 'get_token_a', []).catch(() => ''),
        rpc.contractView<string>(address, 'get_token_b', []).catch(() => ''),
        rpc.getReserves(address).catch(() => ({ reserveA: '0', reserveB: '0' })),
        rpc.contractView<boolean>(address, 'active', []).catch(() => true),
        rpc.contractView<string>(address, 'owner', []).catch(() => ''),
        rpc.contractView<number>(address, 'fee_numerator', []).catch(() => 3),
        rpc.contractView<number>(address, 'fee_denominator', []).catch(() => 1000),
        rpc.contractView<string>(address, 'total_lp', []).catch(() => '0'),
      ]);

      let symbolA = '', symbolB = '';
      try { symbolA = await rpc.contractView<string>(tokenA, 'symbol', []).catch(() => tokenA.slice(0, 6)); } catch { symbolA = '???'; }
      try { symbolB = await rpc.contractView<string>(tokenB, 'symbol', []).catch(() => tokenB.slice(0, 6)); } catch { symbolB = '???'; }

      setPool({
        address,
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
      });

      await loadUserPositions();
    } catch (err) {
      console.error('Failed to load pool details:', err);
      addToast('error', 'Failed to load pool details');
    } finally {
      setLoading(false);
    }
  }, [address, rpc, addToast]);

  const loadUserPositions = async () => {
    if (!address || !isConnected || !walletAddress) return;
    setLoadingPositions(true);
    try {
      const allPositions = await rpc.getAllPositions(CONTRACTS.router).catch(() => []);
      const userPositions = allPositions.filter(
        (pos: any) => pos.pool === address && pos.owner.toLowerCase() === walletAddress.toLowerCase()
      );
      setPositions(userPositions);
    } catch (err) {
      console.error('Failed to load positions:', err);
    } finally {
      setLoadingPositions(false);
    }
  };

  const isPoolRemovable = (p: MyPool) => {
    const emptyA = Number(p.reserveA) === 0 || p.reserveA === '0' || p.reserveA === '';
    const emptyB = Number(p.reserveB) === 0 || p.reserveB === '' || p.reserveB === '';
    const emptyLp = Number(p.totalLp) === 0 || p.totalLp === '0' || p.totalLp === '';
    return emptyA && emptyB && emptyLp;
  };

  const handleRemovePool = async () => {
    if (!pool) return;
    if (confirmText.toLowerCase() !== 'remove') {
      addToast('error', 'Please type REMOVE to confirm');
      return;
    }
    setRemoveStep({ type: 'pending' });
    try {
      const hash = await walletService.callContract({
        contract: CONTRACTS.factory,
        method: 'remove_pool',
        params: [pool.address],
        rpc,
      });
      await rpc.waitForReceipt(hash);
      setRemoveStep({ type: 'done', pool: pool.address });
      setShowConfirm(false);
      addToast('success', `Pool ${pool.address.slice(0,10)}... removed from factory`);
      await loadPoolDetails();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remove failed';
      setRemoveStep({ type: 'error', message: msg });
      addToast('error', `Remove failed: ${msg}`);
    }
  };

  const handleRemovePosition = async (positionId: string) => {
    setPendingPositionRemovals(prev => new Set(prev).add(positionId));
    try {
      const hash = await walletService.callContract({
        contract: CONTRACTS.router,
        method: 'remove_liquidity',
        params: [positionId],
        rpc,
      });
      await rpc.waitForReceipt(hash);
      addToast('success', `Position ${positionId.slice(0,10)}... removed successfully`);
      await loadUserPositions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remove failed';
      addToast('error', `Remove failed: ${msg}`);
    } finally {
      setPendingPositionRemovals(prev => {
        const next = new Set(prev);
        next.delete(positionId);
        return next;
      });
    }
  };

  useEffect(() => {
    loadPoolDetails();
  }, [loadPoolDetails]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      </div>
    );
  }

  if (!pool) {
    return (
      <div className="text-center py-12">
        <div className="text-5xl">❌</div>
        <h2 className="text-xl font-bold text-[var(--app-text)] mt-4">Pool Not Found</h2>
        <p className="text-sm text-[var(--app-muted)] mt-2">The requested pool could not be found.</p>
        <Link to="/my-pools" className="inline-block mt-4 px-4 py-2 bg-[var(--app-blue)] hover:bg-[var(--app-blue-hover)] text-white font-semibold rounded-xl transition-all">
          Back to My Pools
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl w-full space-y-6 pb-16 pt-2 px-2">
      {/* Header with Navigation */}
      <div className="flex items-center gap-4">
        <Link
          to="/my-pools"
          className="flex items-center gap-2 px-3 py-2 bg-[var(--app-panel)] hover:bg-[var(--app-panel-soft)] text-[var(--app-text)] font-semibold rounded-xl transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to My Pools
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 text-xs font-mono text-indigo-400 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            Pool Details
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">
            {pool.symbolA} / {pool.symbolB}
          </h1>
        </div>
      </div>

      {/* Pool Information Card */}
      <div className="bg-[var(--app-panel)] rounded-2xl border border-[var(--app-border)] p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 border-2 border-[var(--app-panel)] flex items-center justify-center text-sm font-bold text-white">
                {pool.symbolA.slice(0, 1)}
              </div>
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 border-2 border-[var(--app-panel)] flex items-center justify-center text-sm font-bold text-white">
                {pool.symbolB.slice(0, 1)}
              </div>
            </div>
            <div>
              <div className="font-bold text-[var(--app-text)] text-lg">{pool.symbolA} / {pool.symbolB}</div>
              <div className="text-xs text-[var(--app-muted)] font-mono">{formatAddress(pool.address)}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full text-xs font-bold ${pool.active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
              {pool.active ? 'Active' : 'Paused'}
            </span>
            <span className="text-xs text-[var(--app-muted)] bg-[var(--app-panel-soft)] px-3 py-1 rounded-lg">
              Fee: {((pool.feeNum / pool.feeDenom) * 100).toFixed(2)}%
            </span>
            <span className="text-xs text-[var(--app-muted)] bg-[var(--app-panel-soft)] px-3 py-1 rounded-lg">
              Owner: {formatAddress(pool.owner)}
            </span>
          </div>
        </div>

        {/* Pool Statistics */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 text-center border border-[var(--app-border-soft)]">
            <div className="text-[10px] text-[var(--app-muted)] uppercase tracking-wider mb-1">Reserve A</div>
            <div className={`font-mono text-lg font-bold ${Number(pool.reserveA) === 0 ? 'text-green-400' : 'text-[var(--app-text)]'}`:
              {Number(pool.reserveA) === 0 ? '0 ✓' : pool.reserveA}
            </div>
          </div>
          <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 text-center border border-[var(--app-border-soft)]">
            <div className="text-[10px] text-[var(--app-muted)] uppercase tracking-wider mb-1">Reserve B</div>
            <div className={`font-mono text-lg font-bold ${Number(pool.reserveB) === 0 ? 'text-green-400' : 'text-[var(--app-text)]'}`:
              {Number(pool.reserveB) === 0 ? '0 ✓' : pool.reserveB}
            </div>
          </div>
          <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 text-center border border-[var(--app-border-soft)]">
            <div className="text-[10px] text-[var(--app-muted)] uppercase tracking-wider mb-1">Total LP</div>
            <div className={`font-mono text-lg font-bold ${Number(pool.totalLp) === 0 ? 'text-green-400' : 'text-[var(--app-text)]'}`:
              {Number(pool.totalLp) === 0 ? '0 ✓' : pool.totalLp}
            </div>
          </div>
        </div>

        {/* Token Addresses */}
        <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 space-y-2">
          <div className="text-xs text-[var(--app-muted)] uppercase tracking-wider mb-2">Token Contracts</div>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-[var(--app-muted)]">Token A:</span>
              <span className="text-[var(--app-text)] break-all">{pool.tokenA}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--app-muted)]">Token B:</span>
              <span className="text-[var(--app-text)] break-all">{pool.tokenB}</span>
            </div>
          </div>
        </div>

        {/* Removal Section */}
        <div className="pt-4 border-t border-[var(--app-border-soft)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[var(--app-text)]">Pool Removal</h3>
              <p className="text-xs text-[var(--app-muted)] mt-1">
                {!isPoolRemovable(pool) && 'Pool can only be removed after all liquidity positions have been withdrawn (zero reserves & zero LP). '}
                {isPoolRemovable(pool) && 'Pool is empty and safe to remove.'}
              </p>
            </div>
            <button
              disabled={!isPoolRemovable(pool)}
              onClick={() => {
                setShowConfirm(true);
                setRemoveStep({ type: 'idle' });
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${isPoolRemovable(pool)
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

          {removeStep.type === 'error' && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3">
              {removeStep.message}
            </div>
          )}
        </div>
      </div>

      {/* User Positions Section */}
      <div className="bg-[var(--app-panel)] rounded-2xl border border-[var(--app-border)] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-[var(--app-text)]">Your Liquidity Positions</h3>
            <p className="text-xs text-[var(--app-muted)] mt-1">
              {positions.length === 0 && 'You have no liquidity positions in this pool.'}
              {positions.length === 1 && 'You have 1 active liquidity position.'}
              {positions.length > 1 && `You have ${positions.length} active liquidity positions.`}
            </p>
          </div>
          {isConnected && positions.length > 0 && (
            <button
              onClick={loadUserPositions}
              className="text-xs text-[var(--app-blue)] hover:text-[var(--app-blue-hover)] font-medium"
            >
              Refresh
            </button>
          )}
        </div>

        {loadingPositions && (
          <div className="flex justify-center py-8">
            <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
          </div>
        )}

        {!loadingPositions && positions.length === 0 && (
          <div className="text-center py-8 text-[var(--app-muted)]">
            <div className="text-3xl mb-2">💰</div>
            <p className="text-sm">No liquidity positions found.</p>
          </div>
        )}

        {positions.map((position) => (
          <LiquidityPosition
            key={position.id}
            position={position}
            onRemove={handleRemovePosition}
          />
        ))}
      </div>

      {/* Removal Confirmation Modal */}
      {showConfirm && pool && (
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
                  <span className="font-mono text-[var(--app-text)] text-xs">{formatAddress(pool.address)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--app-muted)]">Pair</span>
                  <span className="font-bold text-[var(--app-text)]">{pool.symbolA} / {pool.symbolB}</span>
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
