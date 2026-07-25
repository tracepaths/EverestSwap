import type { TokenInfo } from '../types';

export const RPC_URL = import.meta.env.EVERESTSWAP_DEVNET_RPC_URL || 'https://devnet.octrascan.io/rpc';
// [AUDIT-FIX H-5] Indexer must be served over HTTPS from a public endpoint.
// localhost is only a dev fallback; production builds must set EVERESTSWAP_DEVNET_INDEXER_URL.
// [AUDIT-FIX H-5] INDEXER_URL is env-overridable. Default points at the
// hosted indexer service (https://everestswap-indexer-avax.zocomputer.io).
// NOTE: deploying that service requires a plan upgrade (Free = 1 hosted slot,
// currently used by code-server). Until then, set EVERESTSWAP_DEVNET_INDEXER_URL to an
// HTTPS-accessible indexer, or price data fails closed (no silent localhost).
export const INDEXER_URL = import.meta.env.EVERESTSWAP_DEVNET_INDEXER_URL || 'https://everestswap-indexer-avax.zocomputer.io';
// [SECURITY] Devnet-only test keys. These are public testnet credentials.
// NEVER use hardcoded keys for mainnet — mainnet deployer values come
// from EVERESTSWAP_MAINNET_DEPLOYER_* environment variables via config/mainnet.ts
export const DEPLOYER_PUBLIC_KEY = import.meta.env.EVERESTSWAP_DEVNET_DEPLOYER_PUBLIC_KEY || 'lc+hLMhjOhHLOtk2bxw21gKLdPL9HZWEXGUVaVo9oY4=';
export const DEPLOYER_ADDRESS = import.meta.env.EVERESTSWAP_DEVNET_DEPLOYER_ADDRESS || 'oct2mhQQYM3MmDwMxbcpvTCMgSVPxh47YUdZGn3aR1r13PK';

export const OCT_TOKEN: TokenInfo = {
  address: '',
  symbol: 'OCT',
  name: 'Octra Network',
  decimals: 6,
};

export const WOCT_TOKEN: TokenInfo = {
  address: import.meta.env.EVERESTSWAP_DEVNET_WOCT_ADDRESS || 'oct4g33tzC2cJncL5RFr9TRiyk8yCNP1h2xaogiWJS5opNv',
  symbol: 'WOCT',
  name: 'Wrapped OCT',
  decimals: 6,
};

export const OES_TOKEN: TokenInfo = {
  address: import.meta.env.EVERESTSWAP_DEVNET_OES_ADDRESS || 'octGURUy7hQhXHVcP9bovbJnpoXqCv2gpWBrk6fqtXqJ2sC',
  symbol: 'OES',
  name: 'Octra Everest Swap',
  decimals: 6,
};

export const DOGO_TOKEN: TokenInfo = {
  address: import.meta.env.EVERESTSWAP_DEVNET_DOGO_ADDRESS || 'octJ4mZP8bKidAq4VAy5VrcUwgJTh9Dzop5M4fkKqs79J3k',
  symbol: 'DOGO',
  name: 'DOGO',
  decimals: 18,
};

export const CONTRACTS = {
  factory: import.meta.env.EVERESTSWAP_DEVNET_FACTORY_ADDRESS || 'octJbkjXrAqvZdg2JZVZTyQqpYB52HYkBPDmGMmEQBMgSFE',
  pool: import.meta.env.EVERESTSWAP_DEVNET_POOL_ADDRESS || 'oct2ws6ug4Va8R8ctPvE76zyc8fgBJDTC4BgG4WjJXCBo8R',
  router: import.meta.env.EVERESTSWAP_DEVNET_ROUTER_ADDRESS || 'octEtQJQDFC85tXtGpERHX69rNoo1GJA7EVUaLezANQxC8K',
  oes: import.meta.env.EVERESTSWAP_DEVNET_OES_ADDRESS || 'octGURUy7hQhXHVcP9bovbJnpoXqCv2gpWBrk6fqtXqJ2sC',
  woct: import.meta.env.EVERESTSWAP_DEVNET_WOCT_ADDRESS || 'oct4g33tzC2cJncL5RFr9TRiyk8yCNP1h2xaogiWJS5opNv',
  dogo: import.meta.env.EVERESTSWAP_DEVNET_DOGO_ADDRESS || 'octJ4mZP8bKidAq4VAy5VrcUwgJTh9Dzop5M4fkKqs79J3k',
  dogoPool: import.meta.env.EVERESTSWAP_DEVNET_DOGO_POOL_ADDRESS || 'oct764KAUBycN5PiqakWCPFvbzWsRJtG4kbhGkVr6KKawpV',
  rewardPoolTemplate: 'octCfD5XbQwiPUH1CYcQZPJuSuNEbPTtix7LfJAepeGzSr3',
} as const;

// [V7-FIX] Explorer URL fully configurable via env vars
// Default devnet: https://devnet.octrascan.io with /tx.html?hash=<hash>
// path. EXPLORER_TX_PATH may contain the literal placeholder "{hash}"
// (e.g. "/tx.html?hash={hash}") or be a plain prefix concatenated with
// the hash (e.g. "/tx/") for backward compatibility.
// Override with EVERESTSWAP_DEVNET_EXPLORER_URL and EVERESTSWAP_EXPLORER_TX_PATH
export const EXPLORER_URL = import.meta.env.EVERESTSWAP_DEVNET_EXPLORER_URL || 'https://devnet.octrascan.io';
export const EXPLORER_TX_PATH = import.meta.env.EVERESTSWAP_EXPLORER_TX_PATH || '/tx.html?hash={hash}';
