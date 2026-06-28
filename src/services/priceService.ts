import { OCT_ETHEREUM_ADDRESS, DEXSCREENER_API, PRICE_CACHE_TTL_MS } from '../config/prices';
import { WOCT_TOKEN, CONTRACTS } from '../config';
import type { OctraRpc } from './octraRpc';
import { formatUnits } from './swapService';

interface PriceCache {
  octUsd: number;
  timestamp: number;
}

let cache: PriceCache | null = null;

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export async function fetchOctUsdPrice(): Promise<number> {
  const now = Date.now();
  if (cache && (now - cache.timestamp) < PRICE_CACHE_TTL_MS) {
    return cache.octUsd;
  }
  try {
    const res = await fetchWithTimeout(`${DEXSCREENER_API}/${OCT_ETHEREUM_ADDRESS}`);
    if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
    const data = await res.json();
    const price = parseFloat(data?.pairs?.[0]?.priceUsd);
    if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid price');
    cache = { octUsd: price, timestamp: now };
    return price;
  } catch (err) {
    console.error('[priceService] DexScreener fetch failed:', err);
    if (cache) return cache.octUsd;
    return 0;
  }
}

function isOCTorWOCT(address: string): boolean {
  if (!address || address === '') return true;
  return address.toLowerCase() === WOCT_TOKEN.address.toLowerCase();
}

export async function getUsdPriceForToken(
  tokenAddress: string,
  rpc: OctraRpc,
): Promise<number> {
  const octPrice = await fetchOctUsdPrice();
  if (octPrice <= 0) return 0;
  if (isOCTorWOCT(tokenAddress)) return octPrice;

  try {
    const factoryAddr = CONTRACTS.factory;
    const poolAddrs = await rpc.getAllPools(factoryAddr);
    const woctAddr = WOCT_TOKEN.address.toLowerCase();
    const tokenAddrLower = tokenAddress.toLowerCase();

    for (const poolAddr of poolAddrs) {
      const info = await rpc.getPoolInfo(poolAddr);
      if (!info.tokenA || !info.tokenB) continue;

      const aLower = info.tokenA.toLowerCase();
      const bLower = info.tokenB.toLowerCase();

      if (aLower === tokenAddrLower && bLower === woctAddr) {
        const reserveToken = BigInt(info.reserveA);
        const reserveWoct = BigInt(info.reserveB);
        if (reserveToken === 0n) continue;
        const rateWoctPerToken = Number(reserveWoct) / Number(reserveToken);
        return rateWoctPerToken * octPrice;
      }
      if (bLower === tokenAddrLower && aLower === woctAddr) {
        const reserveToken = BigInt(info.reserveB);
        const reserveWoct = BigInt(info.reserveA);
        if (reserveToken === 0n) continue;
        const rateWoctPerToken = Number(reserveWoct) / Number(reserveToken);
        return rateWoctPerToken * octPrice;
      }
    }
  } catch (err) {
    console.error('[priceService] Token price lookup failed:', tokenAddress, err);
  }

  return 0;
}

export function calculateUsdValue(
  rawBalance: string,
  decimals: number,
  usdPrice: number,
): number {
  if (!rawBalance || rawBalance === '0' || usdPrice <= 0) return 0;
  try {
    const human = formatUnits(rawBalance, decimals);
    return parseFloat(human) * usdPrice;
  } catch {
    return 0;
  }
}
