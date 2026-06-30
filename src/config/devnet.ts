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
export const DEPLOYER_ADDRESS = import.meta.env.EVERESTSWAP_DEVNET_DEPLOYER_ADDRESS || 'octGXi34vZfYwi3idjSa6m34vLJCoJHNMNAGeHyqh7JVEvy';

export const OCT_TOKEN: TokenInfo = {
  address: '',
  symbol: 'OCT',
  name: 'Octra Network',
  decimals: 6,
};

export const WOCT_TOKEN: TokenInfo = {
  address: import.meta.env.EVERESTSWAP_DEVNET_WOCT_ADDRESS || 'octLtzi5z7Ls6BFdrBgdGQKiqBKxDPojpfHLpWhHfbDbF8c',
  symbol: 'WOCT',
  name: 'Wrapped OCT',
  decimals: 6,
};

export const OES_TOKEN: TokenInfo = {
  address: import.meta.env.EVERESTSWAP_DEVNET_OES_ADDRESS || 'oct9LgGSpkrqbpWPQpYervyryzDtbGYph2hHvcBi9ZppNvD',
  symbol: 'OES',
  name: 'Octra Everest Swap',
  decimals: 6,
};

export const CONTRACTS = {
  factory: import.meta.env.EVERESTSWAP_DEVNET_FACTORY_ADDRESS || 'octF2kc1Spgxo6BsUazFrg4gCYUMLffEPbcReg6SmmApa2F',
  pool: import.meta.env.EVERESTSWAP_DEVNET_POOL_ADDRESS || 'oct8KN8bSHrNyBjRWt5GPY2RacS31Vwgr3Ga4ZXXGsJcGUe',
  router: import.meta.env.EVERESTSWAP_DEVNET_ROUTER_ADDRESS || 'octAAy94fnLmCavamhcL3LVHB7pa2amxv9By53UqNGMLDgr',
  oes: import.meta.env.EVERESTSWAP_DEVNET_OES_ADDRESS || 'oct9LgGSpkrqbpWPQpYervyryzDtbGYph2hHvcBi9ZppNvD',
  woct: import.meta.env.EVERESTSWAP_DEVNET_WOCT_ADDRESS || 'octLtzi5z7Ls6BFdrBgdGQKiqBKxDPojpfHLpWhHfbDbF8c',
} as const;

// [V7-FIX] Explorer URL fully configurable via env vars
// Default devnet: https://devnet.octrascan.io with /tx.html?hash=<hash>
// path. EXPLORER_TX_PATH may contain the literal placeholder "{hash}"
// (e.g. "/tx.html?hash={hash}") or be a plain prefix concatenated with
// the hash (e.g. "/tx/") for backward compatibility.
// Override with EVERESTSWAP_DEVNET_EXPLORER_URL and EVERESTSWAP_EXPLORER_TX_PATH
export const EXPLORER_URL = import.meta.env.EVERESTSWAP_DEVNET_EXPLORER_URL || 'https://devnet.octrascan.io';
export const EXPLORER_TX_PATH = import.meta.env.EVERESTSWAP_EXPLORER_TX_PATH || '/tx.html?hash={hash}';
