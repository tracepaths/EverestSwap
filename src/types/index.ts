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
