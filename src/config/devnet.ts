import type { TokenInfo } from '../types';

export const RPC_URL = 'https://devnet.octrascan.io/rpc';
export const INDEXER_URL = 'http://localhost:3123';
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
  router: 'oct8FKHqsXXE8z11AwKQ7jhEeU7tXefeY4tTRZEnoWK5S3r',
  oes: 'oct9LgGSpkrqbpWPQpYervyryzDtbGYph2hHvcBi9ZppNvD',
  woct: 'octE7bttbCKJLQskNzHs8MiqCXDjuF2k1JdADv44axxA8LK',
} as const;

// [V7-FIX] Explorer URL fully configurable via env vars
// Default devnet: https://devnet.octrascan.io with /tx/<hash> path
// Override with VITE_EXPLORER_URL_DEVNET and VITE_EXPLORER_TX_PATH
export const EXPLORER_URL = import.meta.env.VITE_EXPLORER_URL_DEVNET || 'https://devnet.octrascan.io';
export const EXPLORER_TX_PATH = import.meta.env.VITE_EXPLORER_TX_PATH || '/tx/';
