export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
}

export interface PoolInfo {
  address: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  reserveA: string;
  reserveB: string;
  totalLP: string;
}

// [V7-FIX] Token launch configuration
export interface TokenLaunchConfig {
  // Step 1: General
  name: string;
  symbol: string;
  contractName: string;
  initialSupply: string;
  decimals: number;
  supplyRecipientMode: 'self' | 'custom';
  customSupplyRecipient: string;
  tokenOwnerMode: 'self' | 'custom';
  customTokenOwner: string;

  // [V7-PASS9] H-14: up to 5 initial trusted addresses (bypass max_wallet)
  // Empty string = unused slot
  trusted1: string;
  trusted2: string;
  trusted3: string;
  trusted4: string;
  trusted5: string;
  mintable: boolean;
  burnable: boolean;
  pausable: boolean;
  blacklist: boolean;
  maxTx: boolean;
  maxTxAmount: string;
  maxWallet: boolean;
  maxWalletAmount: string;
  cooldown: boolean;
  cooldownSeconds: string;
  autoBurn: boolean;
  autoBurnBps: string;
  // [V7-PASS8] H-8 fix: reflection removed (was dead state in contract)

  // Step 3: Taxes
  tax: boolean;
  taxBps: string;
  // [V7-PASS8] H-11 fix: removed 'lp' (not implementable in current contract)
  taxRecipientMode: 'self' | 'burn' | 'custom';
  customTaxRecipient: string;

  // Step 4: Liquidity (for factory.launch())
  liqTokenAmount: string;
  liqWoctAmount: string;
}

// [V9] Reward Pool types
export interface RewardPoolConfig {
  rewardToken: string;
  rewardAmount: string;
  duration: number;       // in epochs
  creatorLockDuration: number;
  distributionType: 'linear';
}

export interface RewardPoolInfo {
  rewardToken: string;
  rewardTotal: string;
  rewardRemaining: string;
  rewardPerEpoch: string;
  rewardStartEpoch: number;
  rewardEndEpoch: number;
  distributionType: number;
  creator: string;
  creatorLockEnd: number;
}

export {
  RPC_URL,
  INDEXER_URL,
  DEPLOYER_PUBLIC_KEY,
  DEPLOYER_ADDRESS,
  OCT_TOKEN,
  WOCT_TOKEN,
  OES_TOKEN,
  CONTRACTS,
  MAINNET_CONFIGURED,
  assertMainnetConfigured,
} from '../config';
