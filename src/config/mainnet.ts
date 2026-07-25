import type { TokenInfo } from '../types';

const required = [
  import.meta.env.EVERESTSWAP_MAINNET_RPC_URL,
  import.meta.env.EVERESTSWAP_MAINNET_INDEXER_URL,
  import.meta.env.EVERESTSWAP_MAINNET_DEPLOYER_PUBLIC_KEY,
  import.meta.env.EVERESTSWAP_MAINNET_DEPLOYER_ADDRESS,
  import.meta.env.EVERESTSWAP_MAINNET_OCT_ADDRESS,
  import.meta.env.EVERESTSWAP_MAINNET_WOCT_ADDRESS,
  import.meta.env.EVERESTSWAP_MAINNET_OES_ADDRESS,
  import.meta.env.EVERESTSWAP_MAINNET_FACTORY_ADDRESS,
  import.meta.env.EVERESTSWAP_MAINNET_POOL_ADDRESS,
  import.meta.env.EVERESTSWAP_MAINNET_ROUTER_ADDRESS,
];

export const MAINNET_CONFIGURED = required.every(Boolean);

export const RPC_URL = import.meta.env.EVERESTSWAP_MAINNET_RPC_URL || '';
export const INDEXER_URL = import.meta.env.EVERESTSWAP_MAINNET_INDEXER_URL || '';
export const DEPLOYER_PUBLIC_KEY = import.meta.env.EVERESTSWAP_MAINNET_DEPLOYER_PUBLIC_KEY || '';
export const DEPLOYER_ADDRESS = import.meta.env.EVERESTSWAP_MAINNET_DEPLOYER_ADDRESS || '';

export const OCT_TOKEN: TokenInfo = {
  address: import.meta.env.EVERESTSWAP_MAINNET_OCT_ADDRESS || '',
  symbol: 'OCT',
  name: 'Octra Network',
  decimals: 6,
};

export const WOCT_TOKEN: TokenInfo = {
  address: import.meta.env.EVERESTSWAP_MAINNET_WOCT_ADDRESS || '',
  symbol: 'WOCT',
  name: 'Wrapped OCT',
  decimals: 6,
};

export const OES_TOKEN: TokenInfo = {
  address: import.meta.env.EVERESTSWAP_MAINNET_OES_ADDRESS || '',
  symbol: 'OES',
  name: 'Octra Everest Swap',
  decimals: 6,
};

export const CONTRACTS = {
  factory: import.meta.env.EVERESTSWAP_MAINNET_FACTORY_ADDRESS || '',
  pool: import.meta.env.EVERESTSWAP_MAINNET_POOL_ADDRESS || '',
  router: import.meta.env.EVERESTSWAP_MAINNET_ROUTER_ADDRESS || '',
  oes: import.meta.env.EVERESTSWAP_MAINNET_OES_ADDRESS || '',
  woct: import.meta.env.EVERESTSWAP_MAINNET_WOCT_ADDRESS || '',
  rewardPoolTemplate: '',
} as const;

// [V7-FIX] Mainnet explorer URL fully configurable via env vars
// Default mainnet: https://octrascan.io with /tx.html?hash=<hash>
// path. EXPLORER_TX_PATH may contain the literal placeholder "{hash}"
// (e.g. "/tx.html?hash={hash}") or be a plain prefix concatenated with
// the hash (e.g. "/tx/") for backward compatibility.
// Override with EVERESTSWAP_MAINNET_EXPLORER_URL and EVERESTSWAP_EXPLORER_TX_PATH
export const EXPLORER_URL = import.meta.env.EVERESTSWAP_MAINNET_EXPLORER_URL || 'https://octrascan.io';
export const EXPLORER_TX_PATH = import.meta.env.EVERESTSWAP_EXPLORER_TX_PATH || '/tx.html?hash={hash}';

export function assertMainnetConfigured(): void {
  if (!MAINNET_CONFIGURED) {
    throw new Error('Mainnet is not configured');
  }
}
