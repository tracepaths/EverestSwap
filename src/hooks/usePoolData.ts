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
            const [tokenA, tokenB, reserveData, active, owner, feeNum, feeDenom, totalLp] = await Promise.all([
              rpc.contractView<string>(addr, 'get_token_a', []).catch(() => ''),
              rpc.contractView<string>(addr, 'get_token_b', []).catch(() => ''),
              rpc.getReserves(addr).catch(() => ({ reserveA: '0', reserveB: '0' })),
              rpc.contractView<boolean>(addr, 'active', []).catch(() => true),
              rpc.contractView<string>(addr, 'owner', []).catch(() => ''),
              rpc.contractView<number>(addr, 'fee_numerator', []).catch(() => 3),
              rpc.contractView<number>(addr, 'fee_denominator', []).catch(() => 1000),
              rpc.contractView<string>(addr, 'total_lp', []).catch(() => '0'),
            ]);

            if (owner.toLowerCase() !== walletAddress.toLowerCase()) return null;

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
