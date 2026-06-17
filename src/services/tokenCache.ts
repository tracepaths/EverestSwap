// [V6-SECURITY-FIX MED-12] Reduce TTL from 5min to 60s to limit stale cache impact
const CACHE_TTL = 60 * 1000;
// [SECURITY] Shorter TTL for isTrusted to limit stale trust badge after factory untrusts a token
const TRUSTED_TTL = 10 * 1000;
let activeNetwork = 'devnet';

interface TokenMeta {
  symbol: string;
  name: string;
  decimals: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const metaCache = new Map<string, CacheEntry<TokenMeta>>();
const trustedCache = new Map<string, CacheEntry<string[]>>();
const isTrustedCache = new Map<string, CacheEntry<boolean>>();

function cacheKey(scope: string, ...parts: string[]): string {
  return [activeNetwork, scope, ...parts].join(':');
}

export function setTokenCacheNetwork(network: string): void {
  activeNetwork = network;
  clearTokenCache();
}

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && (Date.now() - entry.timestamp) < CACHE_TTL;
}

export function getCachedMeta(address: string): TokenMeta | null {
  const entry = metaCache.get(cacheKey('meta', address));
  return isFresh(entry) ? entry.data : null;
}

export function setCachedMeta(address: string, meta: TokenMeta): void {
  metaCache.set(cacheKey('meta', address), { data: meta, timestamp: Date.now() });
}

export function getCachedTrustedTokens(factoryAddress: string): string[] | null {
  const entry = trustedCache.get(cacheKey('trusted', factoryAddress));
  return isFresh(entry) ? entry.data : null;
}

export function setCachedTrustedTokens(factoryAddress: string, tokens: string[]): void {
  trustedCache.set(cacheKey('trusted', factoryAddress), { data: tokens, timestamp: Date.now() });
}

// [V6-SECURITY-FIX MED-12] Cache positive trust with full TTL
// [V7-PASS10] LOW-41: also cache negative trust with shorter TTL to limit RPC load
const NEGATIVE_TRUSTED_TTL = 5_000;  // 5s for negative results

export function setCachedIsTrusted(factoryAddress: string, tokenAddress: string, trusted: boolean): void {
  const key = cacheKey('trusted-token', factoryAddress, tokenAddress);
  if (trusted) {
    isTrustedCache.set(key, { data: trusted, timestamp: Date.now() });
  } else {
    // Cache negative result with a short TTL so we don't hammer RPC for untrusted tokens
    isTrustedCache.set(key, { data: false, timestamp: Date.now() });
  }
}

export function getCachedIsTrusted(factoryAddress: string, tokenAddress: string): boolean | null {
  const entry = isTrustedCache.get(cacheKey('trusted-token', factoryAddress, tokenAddress));
  if (entry === undefined) return null;
  const ttl = entry.data ? TRUSTED_TTL : NEGATIVE_TRUSTED_TTL;
  if (Date.now() - entry.timestamp >= ttl) {
    isTrustedCache.delete(cacheKey('trusted-token', factoryAddress, tokenAddress));
    return null;
  }
  return entry.data;
}

export function clearTokenCache(): void {
  metaCache.clear();
  trustedCache.clear();
  isTrustedCache.clear();
}
