import { useState, useCallback, useEffect } from 'react';
import type { MyPool } from '../utils/poolUtils';
import { useApp } from '../contexts/AppContext';
import { CONTRACTS } from '../types';

export function usePoolData(poolAddress?: string) {
  const { rpc, isConnected, walletAddress } = useApp();
  const [pool, setPool] = useState<MyPool | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPool = useCallback(async (address: string) => {
    if (!address) return;
    setLoading(true);
    try {
      // [FIX] Use `total_lp_supply` view fn (always defined on SwapPool/RewardPool)
      // instead of accessing storage field `total_lp` directly — many RPC nodes
      // reject raw storage access, which previously made .catch() fall back to
      // '0' and falsely reported pools as "removable" when they had active LPs.
      // [V12-FIX] Same storage-field bug as useMyPools: 'active'/'owner'/
      // 'fee_numerator'/'fee_denominator' are NOT callable functions on SwapPool,
      // so these always threw and silently used the fallbacks — the pool detail
      // page showed an empty owner and a hardcoded 0.30% fee.
      const [tokenA, tokenB, reserveData, active, owner, pendingOwner, feeParams, totalLp, userLiquidity] = await Promise.all([
        rpc.contractView<string>(address, 'get_token_a', []).catch(() => ''),
        rpc.contractView<string>(address, 'get_token_b', []).catch(() => ''),
        rpc.getReserves(address).catch(() => ({ reserveA: '0', reserveB: '0' })),
        rpc.getPoolActive(address).catch(() => true),
        rpc.getPoolOwner(address).catch(() => ''),
        rpc.getPoolPendingOwner(address).catch(() => ''),
        rpc.getPoolFeeParams(address).catch(() => ({ numerator: 3, denominator: 1000, percent: '0.30%' })),
        rpc.getTotalLpSupply(address).catch(() => '0'),
        rpc.getPoolUserLiquidity(address).catch(() => '0'),
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
        userLiquidity: String(userLiquidity ?? '0'),
        active: Boolean(active),
        owner: owner,
        pendingOwner: pendingOwner,
        feeNum: Number(feeParams.numerator) || 3,
        feeDenom: Number(feeParams.denominator) || 1000,
      });
    } catch (err) {
      console.error('Failed to load pool details:', err);
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    if (poolAddress) {
      loadPool(poolAddress);
    }
  }, [poolAddress, loadPool]);

  return { pool, loading, loadPool, rpc, isConnected, walletAddress };
}

export function useMyPools() {
  const { rpc, isConnected, walletAddress } = useApp();
  const [myPools, setMyPools] = useState<MyPool[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMyPools = useCallback(async () => {
    if (!isConnected || !walletAddress) return;
    setLoading(true);
    try {
      const allPools = await rpc.getAllPools(CONTRACTS.factory).catch(() => []);
      const poolsWithData = await Promise.all(
        allPools.map(async (addr: string) => {
          try {
            // [V12-FIX] This used to call contractView(addr, 'owner'|'active'|
            // 'fee_numerator'|'fee_denominator'), but none of those are callable
            // functions on SwapPool — they are bare storage fields, so every one
            // returned "method not found" and hit the .catch(). `owner` became ''
            // and the ownership filter below then discarded EVERY pool, leaving
            // "My Pools" permanently empty. Fee values silently fell back to
            // 3/1000 for the same reason.
            const [tokenA, tokenB, reserveData, active, owner, pendingOwner, feeParams, totalLp, userLiquidity] = await Promise.all([
              rpc.contractView<string>(addr, 'get_token_a', []).catch(() => ''),
              rpc.contractView<string>(addr, 'get_token_b', []).catch(() => ''),
              rpc.getReserves(addr).catch(() => ({ reserveA: '0', reserveB: '0' })),
              rpc.getPoolActive(addr).catch(() => true),
              rpc.getPoolOwner(addr).catch(() => ''),
              rpc.getPoolPendingOwner(addr).catch(() => ''),
              rpc.getPoolFeeParams(addr).catch(() => ({ numerator: 3, denominator: 1000, percent: '0.30%' })),
              rpc.getTotalLpSupply(addr).catch(() => '0'),
              rpc.getPoolUserLiquidity(addr).catch(() => '0'),
            ]);

            // Show pools the wallet already owns AND pools where ownership has
            // been proposed to it but not yet accepted — the creator needs to see
            // the latter to be able to accept the handoff at all.
            const wallet = walletAddress.toLowerCase();
            const isOwner = owner.toLowerCase() === wallet;
            const isPendingOwner = pendingOwner !== '' && pendingOwner.toLowerCase() === wallet;
            if (!isOwner && !isPendingOwner) return null;

            let symbolA = '', symbolB = '';
            try { symbolA = await rpc.contractView<string>(tokenA, 'symbol', []).catch(() => tokenA.slice(0, 6)); } catch { symbolA = '???'; }
            try { symbolB = await rpc.contractView<string>(tokenB, 'symbol', []).catch(() => tokenB.slice(0, 6)); } catch { symbolB = '???'; }

            return {
              address: addr,
              tokenA,
              tokenB,
              symbolA,
              symbolB,
              reserveA: reserveData.reserveA,
              reserveB: reserveData.reserveB,
              totalLp: String(totalLp ?? '0'),
              userLiquidity: String(userLiquidity ?? '0'),
              active: Boolean(active),
              owner: owner,
              pendingOwner: pendingOwner,
              feeNum: Number(feeParams.numerator) || 3,
              feeDenom: Number(feeParams.denominator) || 1000,
            } as MyPool;
          } catch {
            return null;
          }
        })
      );
      setMyPools(poolsWithData.filter((p): p is MyPool => p !== null));
    } catch (err) {
      console.error('Failed to load pools:', err);
    } finally {
      setLoading(false);
    }
  }, [rpc, isConnected, walletAddress]);

  useEffect(() => {
    loadMyPools();
  }, [loadMyPools]);

  return { myPools, loading, loadMyPools, rpc, isConnected, walletAddress };
}
