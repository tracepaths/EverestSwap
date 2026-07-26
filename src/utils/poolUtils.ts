import { CONTRACTS } from '../config';
import { walletService } from '../services/walletService';
import { useApp } from '../contexts/AppContext';

export interface MyPool {
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

export type RemoveStep =
  | { type: 'idle' }
  | { type: 'pending' }
  | { type: 'done'; pool: string }
  | { type: 'error'; message: string };

export function formatAddress(a: string): string {
  if (!a || a.length < 14) return a;
  return `${a.slice(0, 10)}...${a.slice(-6)}`;
}

export function isPoolRemovable(p: MyPool): boolean {
  const emptyA = Number(p.reserveA) === 0 || p.reserveA === '0' || p.reserveA === '';
  const emptyB = Number(p.reserveB) === 0 || p.reserveB === '' || p.reserveB === '';
  const emptyLp = Number(p.totalLp) === 0 || p.totalLp === '0' || p.totalLp === '';
  return emptyA && emptyB && emptyLp;
}

export function usePoolRemoval(
  addToast: (type: 'pending' | 'success' | 'error', message: string, txHash?: string) => string,
  onPoolRemoved?: (poolAddress: string) => void
) {
  const { rpc, walletAddress } = useApp();

  const removePool = async (poolAddress: string, confirmText: string): Promise<RemoveStep> => {
    if (confirmText.toLowerCase() !== 'remove') {
      addToast('error', 'Please type REMOVE to confirm');
      return { type: 'error', message: 'Please type REMOVE to confirm' };
    }

    try {
      const hash = await walletService.callContract({
        contract: CONTRACTS.factory,
        method: 'remove_pool',
        params: [poolAddress],
        rpc,
      });
      await rpc.waitForReceipt(hash);
      addToast('success', `Pool ${formatAddress(poolAddress)} removed from factory`);
      onPoolRemoved?.(poolAddress);
      return { type: 'done', pool: poolAddress };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Remove failed';
      addToast('error', `Remove failed: ${msg}`);
      return { type: 'error', message: msg };
    }
  };

  return { removePool, walletAddress };
}
