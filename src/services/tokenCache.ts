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
// [V8] Trust rating caches
const votesCache = new Map<string, CacheEntry<number>>();
const ownerCache = new Map<string, CacheEntry<string>>();
const ratingCache = new Map<string, CacheEntry<number>>();
const VOTES_TTL = 30 * 1000;   // 30s for vote counts
const OWNER_TTL = 5 * 60 * 1000; // 5min for token owners (rarely changes)
const RATING_TTL = 60 * 1000;  // 60s for computed ratings

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

// [V8] Trust rating cache functions
export function getCachedVotes(factoryAddress: string, tokenAddress: string): number | null {
  const entry = votesCache.get(cacheKey('votes', factoryAddress, tokenAddress));
  if (entry === undefined) return null;
  if (Date.now() - entry.timestamp >= VOTES_TTL) {
    votesCache.delete(cacheKey('votes', factoryAddress, tokenAddress));
    return null;
  }
  return entry.data;
}

export function setCachedVotes(factoryAddress: string, tokenAddress: string, votes: number): void {
  votesCache.set(cacheKey('votes', factoryAddress, tokenAddress), { data: votes, timestamp: Date.now() });
}

export function getCachedOwner(tokenAddress: string): string | null {
  const entry = ownerCache.get(cacheKey('owner', tokenAddress));
  if (entry === undefined) return null;
  if (Date.now() - entry.timestamp >= OWNER_TTL) {
    ownerCache.delete(cacheKey('owner', tokenAddress));
    return null;
  }
  return entry.data;
}

export function setCachedOwner(tokenAddress: string, owner: string): void {
  ownerCache.set(cacheKey('owner', tokenAddress), { data: owner, timestamp: Date.now() });
}

export function getCachedRating(factoryAddress: string, tokenAddress: string, walletAddress: string): number | null {
  const entry = ratingCache.get(cacheKey('rating', factoryAddress, tokenAddress, walletAddress));
  if (entry === undefined) return null;
  if (Date.now() - entry.timestamp >= RATING_TTL) {
    ratingCache.delete(cacheKey('rating', factoryAddress, tokenAddress, walletAddress));
    return null;
  }
  return entry.data;
}

export function setCachedRating(factoryAddress: string, tokenAddress: string, walletAddress: string, rating: number): void {
  ratingCache.set(cacheKey('rating', factoryAddress, tokenAddress, walletAddress), { data: rating, timestamp: Date.now() });
}

export function clearTokenCache(): void {
  metaCache.clear();
  trustedCache.clear();
  isTrustedCache.clear();
  votesCache.clear();
  ownerCache.clear();
  ratingCache.clear();
}
