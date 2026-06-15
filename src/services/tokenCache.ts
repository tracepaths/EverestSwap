// [V6-SECURITY-FIX MED-12] Reduce TTL from 5min to 60s to limit stale cache impact
const CACHE_TTL = 60 * 1000;

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

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && (Date.now() - entry.timestamp) < CACHE_TTL;
}

export function getCachedMeta(address: string): TokenMeta | null {
  const entry = metaCache.get(address);
  return isFresh(entry) ? entry.data : null;
}

export function setCachedMeta(address: string, meta: TokenMeta): void {
  metaCache.set(address, { data: meta, timestamp: Date.now() });
}

export function getCachedTrustedTokens(factoryAddress: string): string[] | null {
  const entry = trustedCache.get(factoryAddress);
  return isFresh(entry) ? entry.data : null;
}

export function setCachedTrustedTokens(factoryAddress: string, tokens: string[]): void {
  trustedCache.set(factoryAddress, { data: tokens, timestamp: Date.now() });
}

export function getCachedIsTrusted(factoryAddress: string, tokenAddress: string): boolean | null {
  const entry = isTrustedCache.get(`${factoryAddress}:${tokenAddress}`);
  return isFresh(entry) ? entry.data : null;
}

// [V6-SECURITY-FIX MED-12] Only cache positive trust results to allow re-checking
export function setCachedIsTrusted(factoryAddress: string, tokenAddress: string, trusted: boolean): void {
  if (trusted) {
    isTrustedCache.set(`${factoryAddress}:${tokenAddress}`, { data: trusted, timestamp: Date.now() });
  } else {
    isTrustedCache.delete(`${factoryAddress}:${tokenAddress}`);
  }
}

export function clearTokenCache(): void {
  metaCache.clear();
  trustedCache.clear();
  isTrustedCache.clear();
}
