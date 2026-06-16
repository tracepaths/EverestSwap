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
  address: 'oct3taQXSQetRSmq21hfLmc1ormx7svm112cUB5uEze3oVe',
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
  factory: 'octHrqFJNiZkLSsPGVgG54sEv4DCCJ6pNmtfbZ7FZxAKebG',
  pool: 'octFh3NNUj2JmAorPcrLfcy4bzf5tdk88qDCdFnmjHt12X3',
  router: 'octH9REiXfnhZrhiYBoCEg9c42v4so4ATSakEkkbK3iRKMb',
  oes: 'oct9LgGSpkrqbpWPQpYervyryzDtbGYph2hHvcBi9ZppNvD',
  woct: 'octE7bttbCKJLQskNzHs8MiqCXDjuF2k1JdADv44axxA8LK',
} as const;
