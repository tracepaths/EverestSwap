import type { TokenInfo } from '../types';

const required = [
  import.meta.env.VITE_MAINNET_RPC_URL,
  import.meta.env.VITE_MAINNET_INDEXER_URL,
  import.meta.env.VITE_MAINNET_DEPLOYER_PUBLIC_KEY,
  import.meta.env.VITE_MAINNET_DEPLOYER_ADDRESS,
  import.meta.env.VITE_MAINNET_OCT_ADDRESS,
  import.meta.env.VITE_MAINNET_WOCT_ADDRESS,
  import.meta.env.VITE_MAINNET_OES_ADDRESS,
  import.meta.env.VITE_MAINNET_FACTORY_ADDRESS,
  import.meta.env.VITE_MAINNET_POOL_ADDRESS,
  import.meta.env.VITE_MAINNET_ROUTER_ADDRESS,
];

export const MAINNET_CONFIGURED = required.every(Boolean);

export const RPC_URL = import.meta.env.VITE_MAINNET_RPC_URL || '';
export const INDEXER_URL = import.meta.env.VITE_MAINNET_INDEXER_URL || '';
export const DEPLOYER_PUBLIC_KEY = import.meta.env.VITE_MAINNET_DEPLOYER_PUBLIC_KEY || '';
export const DEPLOYER_ADDRESS = import.meta.env.VITE_MAINNET_DEPLOYER_ADDRESS || '';

export const OCT_TOKEN: TokenInfo = {
  address: import.meta.env.VITE_MAINNET_OCT_ADDRESS || '',
  symbol: 'OCT',
  name: 'Octra Network',
  decimals: 6,
};

export const WOCT_TOKEN: TokenInfo = {
  address: import.meta.env.VITE_MAINNET_WOCT_ADDRESS || '',
  symbol: 'WOCT',
  name: 'Wrapped OCT',
  decimals: 6,
};

export const OES_TOKEN: TokenInfo = {
  address: import.meta.env.VITE_MAINNET_OES_ADDRESS || '',
  symbol: 'OES',
  name: 'Octra Everest Swap',
  decimals: 6,
};

export const CONTRACTS = {
  factory: import.meta.env.VITE_MAINNET_FACTORY_ADDRESS || '',
  pool: import.meta.env.VITE_MAINNET_POOL_ADDRESS || '',
  router: import.meta.env.VITE_MAINNET_ROUTER_ADDRESS || '',
  oes: import.meta.env.VITE_MAINNET_OES_ADDRESS || '',
  woct: import.meta.env.VITE_MAINNET_WOCT_ADDRESS || '',
} as const;

export function assertMainnetConfigured(): void {
  if (!MAINNET_CONFIGURED) {
    throw new Error('Mainnet is not configured');
  }
}
