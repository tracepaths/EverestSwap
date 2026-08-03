import { describe, it, expect } from 'vitest';
import type { MyPool } from '../utils/poolUtils';
import {
  isPoolRemovable,
  isPoolOwner,
  canAcceptOwnership,
  canRemovePool,
  removeBlockedReason,
} from '../utils/poolUtils';

// [V12] Pin the pool-ownership + removal gating rules. These mirror the
// on-chain checks in SwapFactory.remove_pool():
//   - auth: caller == pool.get_owner()
//   - safety: reserve_a == 0 && reserve_b == 0 && total_lp == 0
// and the two-step ownership handoff (factory PROPOSES via transfer_ownership,
// creator must accept_ownership()). If the UI gating drifts from these, users
// see buttons whose transactions revert.

const WALLET = 'octWALLETxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const OTHER = 'octOTHERyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy';
const FACTORY = 'octFACTORYzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';

function pool(overrides: Partial<MyPool> = {}): MyPool {
  return {
    address: 'octPOOL1111111111111111111111111111111111111',
    tokenA: 'octTA', tokenB: 'octTB',
    symbolA: 'A', symbolB: 'B',
    reserveA: '0', reserveB: '0', totalLp: '0',
    userLiquidity: '0',
    active: true,
    owner: WALLET,
    pendingOwner: '',
    feeNum: 3, feeDenom: 1000,
    ...overrides,
  };
}

describe('isPoolOwner', () => {
  it('true when owner matches wallet (case-insensitive)', () => {
    expect(isPoolOwner(pool({ owner: WALLET }), WALLET.toUpperCase())).toBe(true);
  });
  it('false for a different owner', () => {
    expect(isPoolOwner(pool({ owner: OTHER }), WALLET)).toBe(false);
  });
  it('false when wallet or owner empty', () => {
    expect(isPoolOwner(pool({ owner: '' }), WALLET)).toBe(false);
    expect(isPoolOwner(pool({ owner: WALLET }), '')).toBe(false);
  });
});

describe('canAcceptOwnership', () => {
  it('true when pendingOwner is the wallet and it is not already owner', () => {
    expect(canAcceptOwnership(pool({ owner: FACTORY, pendingOwner: WALLET }), WALLET)).toBe(true);
  });
  it('false once the wallet already owns the pool', () => {
    expect(canAcceptOwnership(pool({ owner: WALLET, pendingOwner: WALLET }), WALLET)).toBe(false);
  });
  it('false when pending is someone else', () => {
    expect(canAcceptOwnership(pool({ owner: FACTORY, pendingOwner: OTHER }), WALLET)).toBe(false);
  });
  it('false when no pending owner', () => {
    expect(canAcceptOwnership(pool({ owner: FACTORY, pendingOwner: '' }), WALLET)).toBe(false);
  });
});

describe('isPoolRemovable', () => {
  it('true only when user liquidity is zero', () => {
    expect(isPoolRemovable(pool({ userLiquidity: '0' }))).toBe(true);
  });
  it('true even with leftover dust reserves (minimum_liquidity burned)', () => {
    // remove_pool() gates on total_liquidity, not reserves — a seeded pool keeps
    // dust reserves + burned minimum forever, but is still removable once drained.
    expect(isPoolRemovable(pool({ userLiquidity: '0', reserveA: '3', reserveB: '3', totalLp: '1000' }))).toBe(true);
  });
  it('false with active user liquidity', () => {
    expect(isPoolRemovable(pool({ userLiquidity: '21875000' }))).toBe(false);
  });
});

describe('canRemovePool — owner AND drained', () => {
  it('true when wallet owns a drained pool', () => {
    expect(canRemovePool(pool({ owner: WALLET, userLiquidity: '0' }), WALLET)).toBe(true);
  });
  it('false when drained but not owner (would revert on-chain)', () => {
    expect(canRemovePool(pool({ owner: OTHER, userLiquidity: '0' }), WALLET)).toBe(false);
  });
  it('false when owner but still has user liquidity', () => {
    expect(canRemovePool(pool({ owner: WALLET, userLiquidity: '5' }), WALLET)).toBe(false);
  });
  it('false when ownership only proposed (not yet accepted)', () => {
    expect(canRemovePool(pool({ owner: FACTORY, pendingOwner: WALLET }), WALLET)).toBe(false);
  });
});

describe('removeBlockedReason — precise messaging', () => {
  it('asks to accept ownership first when pending', () => {
    expect(removeBlockedReason(pool({ owner: FACTORY, pendingOwner: WALLET }), WALLET))
      .toMatch(/accept pool ownership/i);
  });
  it('says only owner can remove when not owner and not pending', () => {
    expect(removeBlockedReason(pool({ owner: OTHER, pendingOwner: '' }), WALLET))
      .toMatch(/only the pool owner/i);
  });
  it('says drain first when owner but still has user liquidity', () => {
    expect(removeBlockedReason(pool({ owner: WALLET, userLiquidity: '5' }), WALLET))
      .toMatch(/withdrawn|zero reserves/i);
  });
  it('returns null when removable', () => {
    expect(removeBlockedReason(pool({ owner: WALLET }), WALLET)).toBeNull();
  });
});
