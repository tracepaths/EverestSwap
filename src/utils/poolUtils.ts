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
  /**
   * [V12] Pool ownership is handed over in two steps. `factory.create()` calls
   * `pool.transfer_ownership(creator)`, which only PROPOSES — it sets
   * `pending_owner`. The creator stays a non-owner until they separately call
   * `pool.accept_ownership()`. Until that happens `owner` is still the factory,
   * so `factory.remove_pool()` rejects the creator with "not pool owner or
   * admin". Tracking pendingOwner lets the UI offer that missing step.
   */
  pendingOwner: string;
  /**
   * [V12] User-owned LP (total_liquidity), EXCLUDING the burned minimum_liquidity.
   * This — not totalLp — is what determines removability: total_lp_supply never
   * returns to 0 once a pool is seeded, but total_liquidity does once every user
   * position is withdrawn, which is exactly what remove_pool() now checks.
   */
  userLiquidity: string;
  feeNum: number;
  feeDenom: number;
}

export type RemoveStep =
  | { type: 'idle' }
  | { type: 'pending' }
  | { type: 'done'; pool: string }
  | { type: 'error'; message: string };

export type AcceptOwnershipStep =
  | { type: 'idle' }
  | { type: 'pending' }
  | { type: 'done'; pool: string }
  | { type: 'error'; message: string };

export function formatAddress(a: string): string {
  if (!a || a.length < 14) return a;
  return `${a.slice(0, 10)}...${a.slice(-6)}`;
}

export function isPoolRemovable(p: MyPool): boolean {
  // [V12] Removable once all USER liquidity is withdrawn. remove_pool() gates on
  // total_liquidity == 0, NOT reserves/total_lp == 0 — those never return to 0
  // after a pool is seeded (minimum_liquidity is burned permanently), which made
  // removal impossible under the old check. userLiquidity mirrors the on-chain
  // total_liquidity the factory now reads.
  return Number(p.userLiquidity) === 0 || p.userLiquidity === '0' || p.userLiquidity === '';
}

/**
 * [V12] True when `wallet` is the on-chain owner of the pool.
 * `SwapFactory.remove_pool()` authorises against `pool.get_owner()`, so the UI
 * must gate on exactly this or it shows a button whose tx always reverts.
 */
export function isPoolOwner(p: MyPool, wallet: string): boolean {
  if (!wallet || !p.owner) return false;
  return p.owner.toLowerCase() === wallet.toLowerCase();
}

/**
 * [V12] True when ownership has been proposed to `wallet` but not yet accepted.
 * This is the normal state right after creating a pool through the factory.
 */
export function canAcceptOwnership(p: MyPool, wallet: string): boolean {
  if (!wallet || !p.pendingOwner) return false;
  if (isPoolOwner(p, wallet)) return false;
  return p.pendingOwner.toLowerCase() === wallet.toLowerCase();
}

/**
 * [V12] The pool can only actually be removed when the wallet owns it AND the
 * pool is fully drained. Both conditions are enforced on-chain by remove_pool().
 */
export function canRemovePool(p: MyPool, wallet: string): boolean {
  return isPoolOwner(p, wallet) && isPoolRemovable(p);
}

/**
 * [V12] Human-readable reason the Remove action is unavailable, so the UI can
 * distinguish "you don't own this" from "drain it first" instead of showing one
 * vague disabled button.
 */
export function removeBlockedReason(p: MyPool, wallet: string): string | null {
  if (canAcceptOwnership(p, wallet)) {
    return 'Accept pool ownership first — the factory only proposed it to you.';
  }
  if (!isPoolOwner(p, wallet)) {
    return 'Only the pool owner can remove this pool.';
  }
  if (!isPoolRemovable(p)) {
    return 'Pool can only be removed after all liquidity positions have been withdrawn (zero reserves & zero LP).';
  }
  return null;
}

export function usePoolRemoval(
  addToast: (type: 'pending' | 'success' | 'error', message: string, txHash?: string) => string,
  onPoolRemoved?: (poolAddress: string) => void,
  /**
   * [V12] Separate callback for the ownership handoff. Kept distinct from
   * onPoolRemoved because callers wire that one to navigation ("go back to My
   * Pools" after a delete) — reusing it here would eject the user off the detail
   * page right after they accepted ownership, before they can remove anything.
   */
  onOwnershipAccepted?: (poolAddress: string) => void
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

  /**
   * [V12] Complete the two-step ownership handoff. `factory.create()` proposes
   * ownership to the creator; this claims it. Must succeed before remove_pool()
   * will authorise the caller.
   */
  const acceptOwnership = async (poolAddress: string): Promise<AcceptOwnershipStep> => {
    try {
      const hash = await walletService.callContract({
        contract: poolAddress,
        method: 'accept_ownership',
        params: [],
        rpc,
      });
      await rpc.waitForReceipt(hash);
      addToast('success', `Ownership accepted for ${formatAddress(poolAddress)}`);
      onOwnershipAccepted?.(poolAddress);
      return { type: 'done', pool: poolAddress };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Accept ownership failed';
      addToast('error', `Accept ownership failed: ${msg}`);
      return { type: 'error', message: msg };
    }
  };

  return { removePool, acceptOwnership, walletAddress };
}
