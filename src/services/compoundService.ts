// ── Auto-Compounding Service for EverestSwap LP ──────────────────────────
// Automatically reinvests LP rewards to maximize returns

import { OctraRpc } from './octraRpc';

export interface CompoundEstimate {
  rewards: bigint;
  gasCost: bigint;
  estimatedApr: number;
  nextCompoundTime: number;
}

export interface CompoundConfig {
  enabled: boolean;
  minRewardThreshold: bigint;  // Minimum rewards to trigger compound
  maxGasPrice: bigint;         // Maximum gas price willing to pay
  autoCompoundInterval: number; // Interval in epochs
}

const DEFAULT_CONFIG: CompoundConfig = {
  enabled: true,
  minRewardThreshold: 1000000n, // 1 OCT
  maxGasPrice: 1000000n,
  autoCompoundInterval: 100
};

/**
 * Calculate available rewards for a user in a pool
 */
export async function calculateCompoundRewards(
  rpc: OctraRpc,
  poolAddress: string,
  userAddress: string,
  oesAddress: string
): Promise<CompoundEstimate> {
  try {
    // Get user's LP balance
    const lpBalance = await rpc.call<string>('contract_call', [
      poolAddress,
      'get_lp_balance',
      [userAddress]
    ]);
    
    // Get total LP supply
    const totalLp = await rpc.call<string>('contract_call', [
      poolAddress,
      'total_lp_supply',
      []
    ]);
    
    // Get rewards info from OES
    const rewardsInfo = await rpc.call<[number, number, number, number]>('contract_call', [
      oesAddress,
      'get_rewards_info',
      []
    ]);
    
    // Calculate user's share of rewards
    const userShare = BigInt(lpBalance || '0') / BigInt(totalLp || '1');
    const rewardsPerEpoch = BigInt(rewardsInfo[0] || 0);
    const estimatedRewards = rewardsPerEpoch * userShare;
    
    // Calculate estimated APR
    const epochsPerYear = 525600n; // ~1 year
    const annualRewards = estimatedRewards * epochsPerYear;
    const estimatedApr = Number(annualRewards * 100n / (BigInt(lpBalance || '1') || 1n));
    
    return {
      rewards: estimatedRewards,
      gasCost: 500000n, // Estimated gas cost
      estimatedApr,
      nextCompoundTime: 0
    };
    
  } catch {
    return {
      rewards: 0n,
      gasCost: 0n,
      estimatedApr: 0,
      nextCompoundTime: 0
    };
  }
}

/**
 * Execute auto-compounding for a position
 */
export async function autoCompound(
  rpc: OctraRpc,
  poolAddress: string,
  positionId: number,
  oesAddress: string,
  config: CompoundConfig = DEFAULT_CONFIG
): Promise<string> {
  try {
    // 1. Get position details
    const position = await rpc.call<[string, string, string]>('contract_call', [
      poolAddress,
      'get_position',
      [String(positionId)]
    ]);
    
    const owner = position[0];
    
    // 2. Check if enough rewards
    const estimate = await calculateCompoundRewards(
      rpc,
      poolAddress,
      owner,
      oesAddress
    );
    
    if (estimate.rewards < config.minRewardThreshold) {
      throw new Error('Rewards below threshold');
    }
    
    // 3. Claim rewards from OES (simplified - would need actual implementation)
    // This would involve calling OES.distribute_rewards() or similar
    
    // 4. Add compounded liquidity back to pool
    // This would involve:
    // - Wrapping claimed OCT to WOCT
    // - Granting tokens to pool
    // - Calling add_liquidity with compounded amount
    
    // For now, return placeholder
    return '';
    
  } catch (e) {
    throw new Error(`Compound failed: ${(e as Error).message}`, { cause: e });
  }
}

/**
 * Get optimal compound timing based on gas prices and reward accumulation
 */
export function getOptimalCompoundTime(
  rewardsPerEpoch: bigint,
  currentEpoch: number,
  lastCompoundEpoch: number,
  gasPrice: bigint
): number {
  // Calculate epochs since last compound
  const epochsSinceLast = currentEpoch - lastCompoundEpoch;
  
  // Calculate accumulated rewards
  const accumulatedRewards = rewardsPerEpoch * BigInt(epochsSinceLast);
  
  // Factor in gas cost: wait longer if gas is expensive
  const gasCostThreshold = 500000n; // Base gas cost estimate
  const adjustedThreshold = gasCostThreshold * gasPrice / 1000000n;
  
  // If rewards exceed adjusted threshold, compound now
  if (accumulatedRewards > adjustedThreshold) {
    return currentEpoch;
  }
  
  // Otherwise, wait more epochs
  const epochsToWait = adjustedThreshold > 0n 
    ? Math.ceil(Number(adjustedThreshold / (rewardsPerEpoch || 1n)))
    : Math.ceil(Number(1000000n / (rewardsPerEpoch || 1n)));
  return currentEpoch + epochsToWait;
}

/**
 * Format compound estimate for display
 */
export function formatCompoundEstimate(estimate: CompoundEstimate): string {
  const rewardsOct = Number(estimate.rewards) / 1000000;
  const gasCostOct = Number(estimate.gasCost) / 1000000;
  
  return `Rewards: ${rewardsOct.toFixed(6)} OCT | Gas: ${gasCostOct.toFixed(6)} OCT | APR: ${estimate.estimatedApr.toFixed(2)}%`;
}

// ── [V9] Reward Pool Compound Estimation ─────────────────────────────────

export interface RewardPoolEstimate {
  claimable: bigint;
  rewardPerEpoch: number;
  rewardTokenSymbol: string;
  rewardTokenDecimals: number;
  distributionProgress: number; // 0-100%
}

/**
 * Calculate claimable rewards for a user in a RewardPool
 */
export async function calculateRewardPoolRewards(
  rpc: OctraRpc,
  poolAddress: string,
  _userAddress: string,
  positionId: number
): Promise<RewardPoolEstimate> {
  try {
    const [rewardInfo, claimable, epochRes] = await Promise.all([
      rpc.getRewardInfo(poolAddress),
      rpc.getClaimable(poolAddress, positionId),
      rpc.call<{ epoch_id: number }>('epoch_current'),
    ]);

    const rewardMetaResolved = await rpc.getTokenMeta(rewardInfo.rewardToken);
    const currentEpoch = epochRes?.epoch_id || 0;

    // Calculate distribution progress
    const totalEpochs = rewardInfo.rewardEndEpoch - rewardInfo.rewardStartEpoch;
    const elapsed = Math.max(0, Math.min(currentEpoch - rewardInfo.rewardStartEpoch, totalEpochs));
    const progress = totalEpochs > 0 ? (elapsed / totalEpochs) * 100 : 0;

    // Calculate reward per epoch
    const rewardPerEpoch = totalEpochs > 0
      ? Number(BigInt(rewardInfo.rewardTotal) / BigInt(totalEpochs))
      : 0;

    return {
      claimable: BigInt(claimable),
      rewardPerEpoch,
      rewardTokenSymbol: rewardMetaResolved.symbol || '???',
      rewardTokenDecimals: rewardMetaResolved.decimals,
      distributionProgress: Math.min(100, progress),
    };
  } catch {
    return {
      claimable: 0n,
      rewardPerEpoch: 0,
      rewardTokenSymbol: '???',
      rewardTokenDecimals: 6,
      distributionProgress: 0,
    };
  }
}
