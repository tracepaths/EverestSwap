import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { walletService } from '../services/walletService';
import { OCT_TOKEN, WOCT_TOKEN, OES_TOKEN, CONTRACTS } from '../types';
import { calculateOutput, calculatePriceImpact, formatUnits, parseUnits } from '../services/swapService';
import { useIndexer } from '../hooks/useIndexer';
import { PoolChart } from '../components/PoolChart';
import TokenSelectModal from '../components/TokenSelectModal';

const HARDCODED_TOKENS = [OCT_TOKEN, WOCT_TOKEN, OES_TOKEN];

function SwapPage() {
  const { rpc, isConnected, walletAddress, addToast, updateToast } = useApp();
  const [fromAmount, setFromAmount] = useState('');
  const [fromToken, setFromToken] = useState(WOCT_TOKEN);
  const [toToken, setToToken] = useState(OES_TOKEN);
  const [toAmount, setToAmount] = useState('0');
  const [reserveA, setReserveA] = useState('0');
  const [reserveB, setReserveB] = useState('0');
  const { available: indexerAvailable, prices, loading: indexerLoading } = useIndexer();
  const chartData = prices.map(p => ({ time: Math.floor(p.time) as any, value: p.price }));
  const [slippage, setSlippage] = useState(0.5);
  const [priceImpact, setPriceImpact] = useState(0);
  const [fromBalance, setFromBalance] = useState<string | null>(null);
  const [toBalance, setToBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('Ready to confirm');
  const [progressError, setProgressError] = useState(false);
  const [price, setPrice] = useState('0');
  const [showFromModal, setShowFromModal] = useState(false);
  const [showToModal, setShowToModal] = useState(false);

  const mode = fromToken.address === '' && toToken.address === WOCT_TOKEN.address ? 'wrap'
    : fromToken.address === WOCT_TOKEN.address && toToken.address === '' ? 'unwrap'
    : 'swap';

  const reserveIn = mode === 'swap' ? (fromToken.address === WOCT_TOKEN.address ? reserveA : reserveB) : '0';
  const reserveOut = mode === 'swap' ? (fromToken.address === WOCT_TOKEN.address ? reserveB : reserveA) : '0';

  const loadReserves = useCallback(async () => {
    try {
      const reserves = await rpc.getReserves(CONTRACTS.pool);
      setReserveA(reserves.reserveA);
      setReserveB(reserves.reserveB);
    } catch {}
  }, [rpc]);

  const getTokenBalance = useCallback(async (token: typeof OCT_TOKEN) => {
    if (!isConnected || !walletAddress) return '0';
    if (token.address === '') {
      try {
        const bal = await rpc.getBalance(walletAddress);
        return bal.balance_raw;
      } catch { return '0'; }
    }
    try {
      return await rpc.getTokenBalance(token.address, walletAddress);
    } catch {
      return '0';
    }
  }, [rpc, isConnected, walletAddress]);

  const loadBalances = useCallback(async () => {
    if (!isConnected || !walletAddress) return;
    const fb = await getTokenBalance(fromToken);
    setFromBalance(fb);
    const tb = await getTokenBalance(toToken);
    setToBalance(tb);
  }, [isConnected, walletAddress, getTokenBalance, fromToken, toToken]);

  useEffect(() => {
    loadReserves();
    loadBalances();
    const interval = setInterval(() => { loadReserves(); loadBalances(); }, 10000);
    return () => clearInterval(interval);
  }, [loadReserves, loadBalances]);

  useEffect(() => {
    if (fromAmount && fromAmount !== '0') {
      if (mode === 'wrap' || mode === 'unwrap') {
        setToAmount(fromAmount);
        setPriceImpact(0);
        setPrice('1');
      } else if (reserveIn !== '0') {
        const amountInBN = parseUnits(fromAmount, fromToken.decimals);
        const out = calculateOutput(amountInBN, reserveIn, reserveOut);
        setToAmount(formatUnits(out, toToken.decimals));
        const impact = calculatePriceImpact(amountInBN, reserveIn);
        setPriceImpact(impact);
        const p = Number(formatUnits(reserveOut, toToken.decimals)) / Number(formatUnits(reserveIn, fromToken.decimals));
        setPrice(p.toString());
      }
    } else {
      setToAmount('0');
      setPriceImpact(0);
    }
  }, [fromAmount, reserveIn, reserveOut, fromToken, toToken, mode]);

  useEffect(() => {
    if (!showConfirm) return;
    setProgress(0);
    setProgressLabel('Ready to confirm');
    setProgressError(false);
  }, [showConfirm]);

  const switchTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount('');
    setToAmount('0');
  };

  const handleSelectFromToken = (address: string, meta: { symbol: string; name: string; decimals: number }) => {
    const found = HARDCODED_TOKENS.find(t => t.address === address) || {
      address,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
    };
    if (address === toToken.address) {
      setToToken(found);
    }
    setFromToken(found);
    setShowFromModal(false);
    setFromAmount('');
  };

  const handleSelectToToken = (address: string, meta: { symbol: string; name: string; decimals: number }) => {
    const found = HARDCODED_TOKENS.find(t => t.address === address) || {
      address,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
    };
    if (address === fromToken.address) {
      setFromToken(found);
    }
    setToToken(found);
    setShowToModal(false);
    setFromAmount('');
  };

  const updateProgress = (value: number, label: string, isError = false) => {
    setProgress(Math.max(0, Math.min(100, Math.round(value))));
    setProgressLabel(label);
    setProgressError(isError);
  };

  const handleSwap = async () => {
    setLoading(true);
    let failed = false;
    updateProgress(0, 'Preparing transaction...', false);
    const toastId = addToast('pending', `${actionLabel} in progress...`);
    try {
      const rawAmount = parseUnits(fromAmount, fromToken.decimals);

      if (mode === 'wrap') {
        updateProgress(15, 'Preparing wrap transaction...', false);
        updateToast(toastId, 'pending', 'Approving transaction in wallet...');
        updateProgress(35, 'Waiting for wallet approval...', false);
        const txHash = await walletService.callContract({
          contract: CONTRACTS.woct,
          method: 'deposit',
          params: [],
          amount: rawAmount,
        });
        updateProgress(55, 'Waiting for wrap confirmation...', false);
        updateToast(toastId, 'pending', 'Waiting for transaction confirmation...', txHash);
        await rpc.waitForReceipt(txHash);
        updateProgress(100, 'Wrap completed', false);
        updateToast(toastId, 'success', `${fromAmount} OCT wrapped to WOCT successfully!`, txHash);
      } else if (mode === 'unwrap') {
        updateProgress(15, 'Preparing unwrap transaction...', false);
        updateToast(toastId, 'pending', 'Approving transaction in wallet...');
        updateProgress(35, 'Waiting for wallet approval...', false);
        const txHash = await walletService.callContract({
          contract: CONTRACTS.woct,
          method: 'withdraw',
          params: [rawAmount],
        });
        updateProgress(55, 'Waiting for unwrap confirmation...', false);
        updateToast(toastId, 'pending', 'Waiting for transaction confirmation...', txHash);
        await rpc.waitForReceipt(txHash);
        updateProgress(100, 'Unwrap completed', false);
        updateToast(toastId, 'success', `${fromAmount} WOCT unwrapped to OCT successfully!`, txHash);
      } else {
        const sourceToken = fromToken.address === WOCT_TOKEN.address ? CONTRACTS.woct : CONTRACTS.oes;
        const toRaw = parseUnits(toAmount || '0', toToken.decimals);
        const basisPoints = Math.round(slippage * 100);
        const minOutRaw = BigInt(toRaw) * BigInt(10000 - basisPoints) / 10000n;
        const swapMethod = fromToken.address === WOCT_TOKEN.address ? 'swap_a_for_b' : 'swap_b_for_a';
        const minOutStr = minOutRaw > 0n ? minOutRaw.toString() : '0';

        updateProgress(15, 'Preparing swap transaction...', false);
        updateToast(toastId, 'pending', 'Approving token grant in wallet...');
        updateProgress(35, 'Waiting for token grant approval...', false);
        const grantHash = await walletService.callContract({
          contract: sourceToken,
          method: 'grant',
          params: [CONTRACTS.pool, rawAmount],
        });
        updateProgress(55, 'Waiting for grant confirmation...', false);
        updateToast(toastId, 'pending', 'Waiting for grant confirmation...', grantHash);
        await rpc.waitForReceipt(grantHash);

        updateProgress(70, 'Submitting swap...', false);
        updateToast(toastId, 'pending', 'Approving swap in wallet...');
        updateProgress(85, 'Waiting for swap confirmation...', false);
        const swapHash = await walletService.callContract({
          contract: CONTRACTS.pool,
          method: swapMethod,
          params: [rawAmount, minOutStr, '0'],
        });
        updateToast(toastId, 'pending', 'Waiting for swap confirmation...', swapHash);
        await rpc.waitForReceipt(swapHash);
        updateProgress(100, 'Swap completed', false);
        updateToast(toastId, 'success', `Swap ${fromAmount} ${fromToken.symbol} → ${toAmount} ${toToken.symbol} successful!`, swapHash);
      }

      try { await loadBalances(); } catch {}
      try { await loadReserves(); } catch {}
    } catch (e) {
      failed = true;
      const errMsg = e instanceof Error ? e.message : 'An error occurred';
      updateProgress(100, 'Transaction failed', true);
      updateToast(toastId, 'error', `${actionLabel} failed: ${errMsg}`);
    } finally {
      setLoading(false);
      if (!failed) setShowConfirm(false);
    }
  };

  const actionLabel = mode === 'wrap' ? 'Wrap' : mode === 'unwrap' ? 'Unwrap' : 'Swap';

  return (
    <div className="max-w-lg mx-auto pt-4">
      <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--app-border)]">
          <h2 className="text-lg font-semibold">Swap</h2>
        </div>

        <div className="p-6 space-y-3">
          <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-[var(--app-muted)]">You pay</span>
              <span className="text-xs text-[var(--app-muted)]">
                Balance: {fromBalance === null ? '...' : formatUnits(fromBalance, fromToken.decimals)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={fromAmount}
                onChange={e => setFromAmount(e.target.value)}
                placeholder="0.0"
                className="flex-1 bg-transparent text-2xl font-mono outline-none placeholder-[var(--app-muted-2)]"
              />
              <div className="relative">
                <button
                  onClick={() => setShowFromModal(true)}
                  className="flex items-center gap-1.5 bg-[var(--app-hover)] rounded-lg px-3 py-1.5 hover:bg-[var(--app-hover)] transition-colors"
                >
                  <span className="font-medium">{fromToken.symbol}</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

              </div>
            </div>
            <div className="flex gap-1 mt-2">
              {[10, 25, 50, 100].map(pct => {
                const bal = fromBalance ?? '0';
                const rawPct = BigInt(bal) * BigInt(pct) / 100n;
                return (
                  <button
                    key={pct}
                    onClick={() => setFromAmount(formatUnits(rawPct.toString(), fromToken.decimals))}
                    className="text-xs px-2 py-0.5 rounded bg-[var(--app-hover)] hover:bg-[var(--app-hover)] text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors"
                  >
                    {pct}%
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-center my-3 relative z-10">
            <button
              onClick={switchTokens}
              className="bg-[var(--app-hover)] border-4 border-[var(--app-bg)] rounded-lg p-1.5 hover:bg-[var(--app-hover)] text-[var(--app-blue-3)] hover:text-white transition-all duration-300 hover:rotate-180"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          <div className="bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-[var(--app-muted)]">You receive</span>
              <span className="text-xs text-[var(--app-muted)]">
                Balance: {toBalance === null ? '...' : formatUnits(toBalance, toToken.decimals)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={toAmount}
                readOnly
                placeholder="0.0"
                className="flex-1 bg-transparent text-2xl font-mono outline-none placeholder-[var(--app-muted-2)]"
              />
              <div className="relative">
                <button
                  onClick={() => setShowToModal(true)}
                  className="flex items-center gap-1.5 bg-[var(--app-hover)] rounded-lg px-3 py-1.5 hover:bg-[var(--app-hover)] transition-colors"
                >
                  <span className="font-medium">{toToken.symbol}</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

              </div>
            </div>
          </div>

          <div className="bg-[var(--app-panel-soft)] rounded-xl p-3 space-y-1.5 text-xs">
            <div className="flex justify-between text-[var(--app-muted)]">
              <span>Rate</span>
              <span>1 {fromToken.symbol} = {Number(price).toFixed(6)} {toToken.symbol}</span>
            </div>
            {mode === 'swap' && (
              <>
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>Price Impact</span>
                  <span className={priceImpact > 5 ? 'text-[var(--app-danger)]' : priceImpact > 2 ? 'text-[var(--app-warning)]' : ''}>
                    {priceImpact.toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>Slippage</span>
                  <div className="flex items-center gap-2">
                    {[0.1, 0.5, 1.0].map(v => (
                      <button
                        key={v}
                        onClick={() => setSlippage(v)}
                        className={`px-2 py-0.5 rounded ${slippage === v ? 'bg-[var(--app-blue)] text-[var(--app-text)]' : 'bg-[var(--app-hover)] text-[var(--app-muted)]'}`}
                      >
                        {v}%
                      </button>
                    ))}
                    <input
                      type="number"
                      value={slippage}
                      onChange={e => setSlippage(Number(e.target.value))}
                      className="w-14 bg-[var(--app-hover)] rounded px-2 py-0.5 text-right outline-none"
                      step={0.1}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-[var(--app-muted)]">
                  <span>Fee (0.3%)</span>
                  <span>{fromAmount ? (Number(fromAmount) * 0.003).toFixed(6) : '0'} {fromToken.symbol}</span>
                </div>
              </>
            )}
            {mode !== 'swap' && (
              <div className="flex justify-between text-[var(--app-muted)]">
                <span>Network Fee</span>
                <span>~0.1 OCT</span>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowConfirm(true)}
            disabled={!fromAmount || Number(fromAmount) <= 0 || !isConnected}
            className="w-full py-3 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:bg-[var(--app-panel)] disabled:text-[var(--app-muted-2)] rounded-xl font-medium transition-colors"
          >
            {!isConnected ? 'Connect Wallet' : !fromAmount || Number(fromAmount) <= 0 ? 'Enter Amount' : actionLabel}
          </button>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-xl z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-semibold">Confirm {actionLabel}</h3>
            <div className="space-y-3 bg-[var(--app-panel-soft)] rounded-xl p-4 text-sm">
              {mode === 'swap' ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">You pay</span>
                    <span className="font-medium">{fromAmount} {fromToken.symbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">You receive</span>
                    <span className="font-medium">~{toAmount} {toToken.symbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">Price Impact</span>
                    <span>{priceImpact.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">Min received</span>
                    <span className="font-medium">
                      ~{(Number(toAmount) * (1 - slippage / 100)).toFixed(6)} {toToken.symbol}
                    </span>
                  </div>
                  <div className="border-t border-[var(--app-border)] my-2" />
                  <div className="flex justify-between text-[var(--app-muted)]">
                    <span>Fee (0.3%)</span>
                    <span>{(Number(fromAmount) * 0.003).toFixed(6)} {fromToken.symbol}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">You {mode === 'wrap' ? 'wrap' : 'unwrap'}</span>
                    <span className="font-medium">{fromAmount} {fromToken.symbol}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--app-muted)]">You receive</span>
                    <span className="font-medium">{toAmount} {toToken.symbol}</span>
                  </div>
                  <div className="border-t border-[var(--app-border)] my-2" />
                  <div className="flex justify-between text-[var(--app-muted)]">
                    <span>Network Fee</span>
                    <span>~0.1 OCT</span>
                  </div>
                </>
              )}
            </div>
            <div className="space-y-2 bg-[var(--app-panel-soft)] rounded-xl p-4 border border-[var(--app-border)]">
              <div className="flex items-center justify-between text-xs">
                <span className={progressError ? 'text-[var(--app-danger)]' : 'text-[var(--app-muted)]'}>{progressLabel}</span>
                <span className={`font-mono ${progressError ? 'text-[var(--app-danger)]' : 'text-[var(--app-blue-3)]'}`}>{progress}%</span>
              </div>
              <div className="h-2 bg-[var(--app-panel-soft)] rounded-full overflow-hidden border border-[var(--app-border)]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    progressError
                      ? 'bg-gradient-to-r from-red-500 to-orange-500'
                      : 'bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)]'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={loading}
                className="flex-1 py-2.5 bg-[var(--app-panel-soft)] border border-[var(--app-border)] rounded-xl font-medium hover:bg-[var(--app-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleSwap}
                disabled={loading}
                className="flex-1 py-2.5 bg-gradient-to-r from-[var(--app-blue)] to-[var(--app-blue-2)] rounded-xl font-medium hover:from-[var(--app-blue-2)] hover:to-[var(--app-blue-3)] disabled:opacity-50 transition-colors"
              >
                {loading ? `${actionLabel}...` : `Confirm ${actionLabel}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {indexerAvailable && (
        <div className="mt-6 bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl p-5 border border-[var(--app-border)]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">OES / WOCT Price</h3>
            <span className="text-xs text-[var(--app-muted-2)]">Live</span>
          </div>
          {indexerLoading ? (
            <div className="h-[200px] bg-[var(--app-panel-soft)] rounded animate-pulse" />
          ) : (
            <PoolChart data={chartData} height={200} />
          )}
        </div>
      )}

      <div className="mt-6 bg-[var(--app-panel)] backdrop-blur-xl rounded-2xl border border-[var(--app-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--app-border)]">
          <h3 className="text-sm font-semibold">Pool Reserves</h3>
        </div>
        <div className="p-4 text-sm text-[var(--app-muted)] font-mono">
          <div className="flex justify-between py-1">
            <span>WOCT Reserve:</span>
            <span>{formatUnits(reserveA, fromToken.decimals)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span>OES Reserve:</span>
            <span>{formatUnits(reserveB, toToken.decimals)}</span>
          </div>
        </div>
      </div>

      <TokenSelectModal
        isOpen={showFromModal}
        onClose={() => setShowFromModal(false)}
        onSelect={handleSelectFromToken}
        rpc={rpc}
        excludeAddress={toToken.address || undefined}
        walletAddress={walletAddress}
        isConnected={isConnected}
      />
      <TokenSelectModal
        isOpen={showToModal}
        onClose={() => setShowToModal(false)}
        onSelect={handleSelectToToken}
        rpc={rpc}
        excludeAddress={fromToken.address || undefined}
        walletAddress={walletAddress}
        isConnected={isConnected}
      />
    </div>
  );
}

export default SwapPage;
