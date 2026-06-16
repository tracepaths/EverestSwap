import type { TokenInfo } from '../types';

import {
  RPC_URL as DEV_RPC_URL,
  INDEXER_URL as DEV_INDEXER_URL,
  DEPLOYER_PUBLIC_KEY as DEV_DPL_PUBKEY,
  DEPLOYER_ADDRESS as DEV_DPL_ADDR,
  OCT_TOKEN as DEV_OCT,
  WOCT_TOKEN as DEV_WOCT,
  OES_TOKEN as DEV_OES,
  CONTRACTS as DEV_CONTRACTS,
  EXPLORER_URL as DEV_EXPLORER_URL,
  EXPLORER_TX_PATH as DEV_EXPLORER_TX_PATH,
} from './devnet';

import {
  RPC_URL as MAIN_RPC_URL,
  INDEXER_URL as MAIN_INDEXER_URL,
  DEPLOYER_PUBLIC_KEY as MAIN_DPL_PUBKEY,
  DEPLOYER_ADDRESS as MAIN_DPL_ADDR,
  OCT_TOKEN as MAIN_OCT,
  WOCT_TOKEN as MAIN_WOCT,
  OES_TOKEN as MAIN_OES,
  CONTRACTS as MAIN_CONTRACTS,
  EXPLORER_URL as MAIN_EXPLORER_URL,
  EXPLORER_TX_PATH as MAIN_EXPLORER_TX_PATH,
  MAINNET_CONFIGURED,
  assertMainnetConfigured,
} from './mainnet';

const network = import.meta.env.VITE_NETWORK || 'devnet';
const isMainnet = network === 'mainnet';

export const RPC_URL: string = isMainnet ? MAIN_RPC_URL : DEV_RPC_URL;
export const INDEXER_URL: string = isMainnet ? MAIN_INDEXER_URL : DEV_INDEXER_URL;
export const DEPLOYER_PUBLIC_KEY: string = isMainnet ? MAIN_DPL_PUBKEY : DEV_DPL_PUBKEY;
export const DEPLOYER_ADDRESS: string = isMainnet ? MAIN_DPL_ADDR : DEV_DPL_ADDR;
export const OCT_TOKEN: TokenInfo = isMainnet ? MAIN_OCT : DEV_OCT;
export const WOCT_TOKEN: TokenInfo = isMainnet ? MAIN_WOCT : DEV_WOCT;
export const OES_TOKEN: TokenInfo = isMainnet ? MAIN_OES : DEV_OES;
export const CONTRACTS = isMainnet ? MAIN_CONTRACTS : DEV_CONTRACTS;
// [V7-FIX] Network-aware explorer URL config
export const EXPLORER_URL: string = isMainnet ? MAIN_EXPLORER_URL : DEV_EXPLORER_URL;
export const EXPLORER_TX_PATH: string = isMainnet ? MAIN_EXPLORER_TX_PATH : DEV_EXPLORER_TX_PATH;
export { MAINNET_CONFIGURED, assertMainnetConfigured };
