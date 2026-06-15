import type { TokenInfo } from '../types';

export const RPC_URL = '';
export const INDEXER_URL = 'http://localhost:3123';
export const DEPLOYER_PUBLIC_KEY = '';
export const DEPLOYER_ADDRESS = '';

export const OCT_TOKEN: TokenInfo = {
  address: '',
  symbol: 'OCT',
  name: 'Octra Network',
  decimals: 6,
};

export const WOCT_TOKEN: TokenInfo = {
  address: '',
  symbol: 'WOCT',
  name: 'Wrapped OCT',
  decimals: 6,
};

export const OES_TOKEN: TokenInfo = {
  address: '',
  symbol: 'OES',
  name: 'Octra Everest Swap',
  decimals: 6,
};

export const CONTRACTS = {
  factory: '',
  pool: '',
  router: '',
  oes: '',
  woct: '',
} as const;
