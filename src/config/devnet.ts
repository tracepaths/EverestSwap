import type { TokenInfo } from '../types';

export const RPC_URL = 'https://devnet.octrascan.io/rpc';
// [AUDIT-FIX H-5] Indexer must be served over HTTPS from a public endpoint.
// localhost is only a dev fallback; production builds must set VITE_INDEXER_URL.
// [AUDIT-FIX H-5] INDEXER_URL is env-overridable. Default points at the
// hosted indexer service (https://everestswap-indexer-avax.zocomputer.io).
// NOTE: deploying that service requires a plan upgrade (Free = 1 hosted slot,
// currently used by code-server). Until then, set VITE_INDEXER_URL to an
// HTTPS-accessible indexer, or price data fails closed (no silent localhost).
export const INDEXER_URL = import.meta.env.VITE_INDEXER_URL || 'https://everestswap-indexer-avax.zocomputer.io';
// [SECURITY] Devnet-only test keys. These are public testnet credentials.
// NEVER use hardcoded keys for mainnet — mainnet deployer values come
// from VITE_MAINNET_DEPLOYER_* environment variables via config/mainnet.ts
export const DEPLOYER_PUBLIC_KEY = 'lc+hLMhjOhHLOtk2bxw21gKLdPL9HZWEXGUVaVo9oY4=';
export const DEPLOYER_ADDRESS = 'octGXi34vZfYwi3idjSa6m34vLJCoJHNMNAGeHyqh7JVEvy';

export const OCT_TOKEN: TokenInfo = {
  address: '',
  symbol: 'OCT',
  name: 'Octra Network',
  decimals: 6,
};

export const WOCT_TOKEN: TokenInfo = {
  address: 'octE7bttbCKJLQskNzHs8MiqCXDjuF2k1JdADv44axxA8LK',
  symbol: 'WOCT',
  name: 'Wrapped OCT',
  decimals: 6,
};

export const OES_TOKEN: TokenInfo = {
  address: 'oct9LgGSpkrqbpWPQpYervyryzDtbGYph2hHvcBi9ZppNvD',
  symbol: 'OES',
  name: 'Octra Everest Swap',
  decimals: 6,
};

export const CONTRACTS = {
  factory: 'octFmVqADVjj8v1WSr4ex6EJd2TPRf1JjUVHb3tK29YTXTV',
  pool: 'octFh3NNUj2JmAorPcrLfcy4bzf5tdk88qDCdFnmjHt12X3',
  router: 'octFxNmmEQ9VbnefP9zGGhyPexsWnU7CnHMTB3vxPubNyZG',
  oes: 'oct9LgGSpkrqbpWPQpYervyryzDtbGYph2hHvcBi9ZppNvD',
  woct: 'octE7bttbCKJLQskNzHs8MiqCXDjuF2k1JdADv44axxA8LK',
} as const;

// [V7-FIX] Explorer URL fully configurable via env vars
// Default devnet: https://devnet.octrascan.io with /tx/<hash> path
// Override with VITE_EXPLORER_URL_DEVNET and VITE_EXPLORER_TX_PATH
export const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL_DEVNET || 'https://devnet.octrascan.io';
export const EXPLORER_TX_PATH = import.meta.env.VITE_EXPLORER_TX_PATH || '/tx/';
