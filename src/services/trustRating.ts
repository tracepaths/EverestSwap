// [V8] Token trust rating service
// Calculates 1-5 star rating based on: deployer match, factory trust, community votes, locked LP

import type { OctraRpc } from './octraRpc';
import {
  getCachedVotes, setCachedVotes,
  getCachedOwner, setCachedOwner,
  getCachedRating, setCachedRating,
} from './tokenCache';
import { WOCT_TOKEN } from '../config';

export interface TrustRating {
  rating: number;        // 1-5
  label: string;
  reason: string;
  votes: number;
  hasVoted: boolean;
  lockedLpPct: number;   // 0-100
}

const RATING_LABELS: Record<number, string> = {
  1: 'Unverified',
  2: 'Low',
  3: 'Medium',
  4: 'High',
  5: 'Trusted',
};

function clampRating(r: number): number {
  return Math.max(1, Math.min(5, r));
}

/**
 * Calculate trust rating for a token.
 *
 * Rules:
 * - Native OCT (empty address) → 5 stars
 * - Token owner == walletAddress → 5 stars (deployed by you)
 * - Factory-trusted → 5 stars
 * - Base 1 star for others
 * - Votes → +1 star per 100 weight (max +3)
 * - Locked LP > 50% → +1 star
 * - Clamp 1-5
 */
export async function calculateRating(params: {
  rpc: OctraRpc;
  factoryAddress: string;
  tokenAddress: string;
  walletAddress: string;
  isTrusted: boolean;
}): Promise<TrustRating> {
  const { rpc, factoryAddress, tokenAddress, walletAddress, isTrusted } = params;

  // Native OCT
  if (!tokenAddress || tokenAddress === '') {
    return { rating: 5, label: 'Trusted', reason: 'Native token', votes: 0, hasVoted: false, lockedLpPct: 0 };
  }

  // Check cache
  const cached = getCachedRating(factoryAddress, tokenAddress, walletAddress);
  if (cached !== null) {
    // Still need to return full info, rebuild from cache + fresh data
    const [votes, hasVoted, lockedLpPct, owner] = await Promise.all([
      getVotes(rpc, factoryAddress, tokenAddress),
      getHasVoted(rpc, factoryAddress, walletAddress, tokenAddress),
      getLockedLpPct(rpc, factoryAddress, tokenAddress),
      getOwner(rpc, tokenAddress),
    ]);
    return buildRating(cached, votes, hasVoted, lockedLpPct, owner, walletAddress, isTrusted);
  }

  // Fetch all data in parallel
  const [votes, hasVoted, lockedLpPct, owner] = await Promise.all([
    getVotes(rpc, factoryAddress, tokenAddress),
    getHasVoted(rpc, factoryAddress, walletAddress, tokenAddress),
    getLockedLpPct(rpc, factoryAddress, tokenAddress),
    getOwner(rpc, tokenAddress),
  ]);

  // Calculate rating
  let rating: number;
  if (owner && walletAddress && owner === walletAddress) {
    // Deployer match → 5 stars
    rating = 5;
  } else if (isTrusted) {
    // Factory-trusted → 5 stars
    rating = 5;
  } else {
    // Base 1, add vote bonus: +1 star per 100 votes (max +3)
    const voteBonus = Math.min(3, Math.floor(votes / 100));
    rating = 1 + voteBonus;
  }

  // Locked LP > 50% → +1 star (max 5)
  if (lockedLpPct > 50 && rating < 5) {
    rating += 1;
  }

  rating = clampRating(rating);
  setCachedRating(factoryAddress, tokenAddress, walletAddress, rating);

  return buildRating(rating, votes, hasVoted, lockedLpPct, owner, walletAddress, isTrusted);
}

function buildRating(
  rating: number,
  votes: number,
  hasVoted: boolean,
  lockedLpPct: number,
  owner: string,
  walletAddress: string,
  isTrusted: boolean,
): TrustRating {
  const reason = (owner && owner === walletAddress)
    ? 'Deployed by you'
    : isTrusted
    ? 'Trusted by admin'
    : rating >= 4
    ? 'Community validated'
    : lockedLpPct > 50
    ? 'Secured liquidity'
    : votes > 0
    ? `${votes} community votes`
    : 'No verification';

  return {
    rating,
    label: RATING_LABELS[rating] || 'Unknown',
    reason,
    votes,
    hasVoted,
    lockedLpPct,
  };
}

async function getVotes(rpc: OctraRpc, factoryAddress: string, tokenAddress: string): Promise<number> {
  const cached = getCachedVotes(factoryAddress, tokenAddress);
  if (cached !== null) return cached;
  const votes = await rpc.getTokenVotes(factoryAddress, tokenAddress);
  setCachedVotes(factoryAddress, tokenAddress, votes);
  return votes;
}

async function getHasVoted(rpc: OctraRpc, factoryAddress: string, voterAddress: string, tokenAddress: string): Promise<boolean> {
  if (!voterAddress) return false;
  return rpc.hasVoted(factoryAddress, voterAddress, tokenAddress);
}

async function getOwner(rpc: OctraRpc, tokenAddress: string): Promise<string> {
  const cached = getCachedOwner(tokenAddress);
  if (cached !== null) return cached;
  const owner = await rpc.getTokenOwner(tokenAddress);
  setCachedOwner(tokenAddress, owner);
  return owner;
}

async function getLockedLpPct(rpc: OctraRpc, factoryAddress: string, tokenAddress: string): Promise<number> {
  try {
    // Find pool for token/WOCT pair (use WOCT address, not empty string for native)
    const poolAddress = await rpc.getPoolAddress(factoryAddress, tokenAddress, WOCT_TOKEN.address);
    if (!poolAddress) return 0;

    const [totalLocked, totalLp] = await Promise.all([
      rpc.getTotalLockedLp(poolAddress),
      rpc.getPoolInfo(poolAddress).then(info => parseInt(info.totalLP || '0', 10)).catch(() => 0),
    ]);

    if (!totalLp || totalLp === 0) return 0;
    return Math.round((Number(totalLocked) / totalLp) * 100);
  } catch {
    return 0;
  }
}
