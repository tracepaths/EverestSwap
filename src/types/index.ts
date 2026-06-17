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

// [V7-FIX] TokenV2 launch configuration
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

  // Step 2: Optional Features
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
