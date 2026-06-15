import type { TokenInfo } from '../types';

export const RPC_URL = 'https://devnet.octrascan.io/rpc';
export const INDEXER_URL = 'http://localhost:3123';
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
  factory: 'oct6znV2kFvbNnVpQRWKUq3Hw2mhPEW5Yi5NCJfAVPhQrsE',
  pool: 'octSM8utNG3MLv4Fk2oY1SA2XR99o2i22QUSLbr7Te2tSM4',
  router: 'oct53wqh6cng95sjLTeLGdSWfNNtfnxy8W3A7H4NK9XmQzY',
  oes: 'oct9LgGSpkrqbpWPQpYervyryzDtbGYph2hHvcBi9ZppNvD',
  woct: 'oct3taQXSQetRSmq21hfLmc1ormx7svm112cUB5uEze3oVe',
} as const;
