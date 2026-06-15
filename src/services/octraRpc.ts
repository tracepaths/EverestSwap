import { RPC_URL as CONFIG_RPC_URL } from '../config';
import { getCachedMeta, setCachedMeta, getCachedTrustedTokens, setCachedTrustedTokens, getCachedIsTrusted, setCachedIsTrusted, clearTokenCache, setTokenCacheNetwork } from './tokenCache';

export interface LpPosition {
  id: number;
  owner: string;
  liquidity: string;
  unlockTime: number;
}

export class OctraRpc {
  private url: string;

  constructor(url: string = CONFIG_RPC_URL) {
    this.url = url || 'https://devnet.octrascan.io/rpc';
    // [V6-SECURITY-FIX MED-11] Enforce HTTPS on RPC URL
    if (this.url && !this.url.startsWith('https://')) {
      throw new Error('RPC URL must use HTTPS');
    }
  }

  // [V6-SECURITY-FIX MED-10] Add fetch timeout to prevent UI hang
  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const json = await res.json();
      if (json.error) throw new Error(json.error.message || 'RPC error');
      if (json.result === undefined || json.result === null) {
        throw new Error('RPC returned null result');
      }
      return json.result as T;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new Error('RPC request timed out (15s)', { cause: e });
      }
      throw e;
    }
  }

  async getBalance(address: string): Promise<{ balance: string; balance_raw: string; nonce: number }> {
    return this.call('octra_balance', [address]);
  }

  async contractView<T = unknown>(contract: string, method: string, params: unknown[] = [], caller?: string): Promise<T> {
    const args: unknown[] = [contract, method, params];
    if (caller) args.push(caller);
    return this.call<T>('contract_call', args);
  }

  async getTokenBalance(tokenAddress: string, userAddress: string): Promise<string> {
    const result = await this.contractView<{ result: string }>(tokenAddress, 'balance_of', [userAddress]);
    if (result && typeof result === 'object') {
      const inner = (result as Record<string, unknown>).result;
      if (inner != null && typeof inner !== 'object') return String(inner);
    }
    if (result != null && typeof result !== 'object') return String(result);
    return '0';
  }

  async getPublicKey(address: string): Promise<string> {
    return this.call<string>('octra_publicKey', [address]);
  }

  async getReserves(poolAddress: string): Promise<{ reserveA: string; reserveB: string }> {
    const raw: unknown = await this.contractView(poolAddress, 'get_reserves', []);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const storage = obj.storage as Record<string, string> | undefined;
      if (storage?.reserve_a != null && storage?.reserve_b != null) {
        return { reserveA: String(storage.reserve_a), reserveB: String(storage.reserve_b) };
      }
      const resVal = obj.result;
      if (Array.isArray(resVal) && resVal.length >= 2) {
        return { reserveA: String(resVal[0]), reserveB: String(resVal[1]) };
      }
      if (typeof resVal === 'string') {
        const sep = resVal.includes(':') ? ':' : ',';
        const parts = resVal.split(sep);
        if (parts.length >= 2) {
          return { reserveA: parts[0], reserveB: parts[1] };
        }
      }
    }
    if (Array.isArray(raw) && raw.length >= 2) {
      return { reserveA: String(raw[0]), reserveB: String(raw[1]) };
    }
    if (typeof raw === 'string') {
      const sep = raw.includes(':') ? ':' : ',';
      const parts = raw.split(sep);
      if (parts.length >= 2) {
        return { reserveA: parts[0], reserveB: parts[1] };
      }
    }
    return { reserveA: '0', reserveB: '0' };
  }

  async getPrice(poolAddress: string): Promise<string> {
    const result = await this.contractView<{ result: string }>(poolAddress, 'get_price', []);
    if (result && typeof result === 'object') {
      const inner = (result as Record<string, unknown>).result;
      if (inner != null && typeof inner !== 'object') return String(inner);
    }
    if (result != null && typeof result !== 'object') return String(result);
    return '0';
  }

  async getLpBalance(poolAddress: string, userAddress: string): Promise<string> {
    const raw: unknown = await this.contractView(poolAddress, 'get_lp_balance', [userAddress]);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (obj.result != null) return String(obj.result);
    }
    if (raw != null) return String(raw);
    return '0';
  }

  async getPositionCount(poolAddress: string, userAddress: string): Promise<number> {
    const raw: unknown = await this.contractView(poolAddress, 'get_position_count', [userAddress]);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (obj.result != null) return Number(obj.result);
    }
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') return Number(raw);
    return 0;
  }

  async getUnlockedLiquidity(poolAddress: string, userAddress: string): Promise<string> {
    const raw: unknown = await this.contractView(poolAddress, 'get_unlocked_liquidity', [userAddress]);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (obj.result != null) return String(obj.result);
    }
    if (raw != null) return String(raw);
    return '0';
  }

  async getLockedLiquidity(poolAddress: string, userAddress: string): Promise<string> {
    const raw: unknown = await this.contractView(poolAddress, 'get_locked_liquidity', [userAddress]);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (obj.result != null) return String(obj.result);
    }
    if (raw != null) return String(raw);
    return '0';
  }

  async getPosition(poolAddress: string, positionId: number): Promise<LpPosition> {
    const raw: unknown = await this.contractView(poolAddress, 'get_position', [positionId]);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const storage = obj.storage as Record<string, unknown> | undefined;
      if (storage) {
        const owner = String(storage[`position_owners:${positionId}`] ?? '');
        const liquidity = String(storage[`position_liquidities:${positionId}`] ?? '0');
        const unlockTime = Number(storage[`position_unlock_times:${positionId}`] ?? 0);
        return { id: positionId, owner, liquidity, unlockTime };
      }
      const arr = obj.result;
      if (Array.isArray(arr) && arr.length >= 3) {
        return {
          id: positionId,
          owner: String(arr[0]),
          liquidity: String(arr[1]),
          unlockTime: Number(arr[2]),
        };
      }
      if (typeof arr === 'string') {
        return this.parseLengthPrefixedPosition(positionId, arr);
      }
    }
    if (Array.isArray(raw) && raw.length >= 3) {
      return {
        id: positionId,
        owner: String(raw[0]),
        liquidity: String(raw[1]),
        unlockTime: Number(raw[2]),
      };
    }
    if (typeof raw === 'string') {
      return this.parseLengthPrefixedPosition(positionId, raw);
    }
    return { id: positionId, owner: '', liquidity: '0', unlockTime: 0 };
  }

  private parseLengthPrefixedPosition(positionId: number, s: string): LpPosition {
    try {
      const parts: string[] = [];
      let i = 0;
      while (i < s.length) {
        const hashIdx = s.indexOf('#', i);
        if (hashIdx === -1) break;
        const len = parseInt(s.substring(i, hashIdx));
        const value = s.substring(hashIdx + 1, hashIdx + 1 + len);
        parts.push(value);
        i = hashIdx + 1 + len;
      }
      if (parts.length >= 3) {
        return { id: positionId, owner: parts[0], liquidity: parts[1], unlockTime: Number(parts[2]) };
      }
    } catch { /* noop */ }
    return { id: positionId, owner: '', liquidity: '0', unlockTime: 0 };
  }

  async getPositions(poolAddress: string, userAddress: string): Promise<LpPosition[]> {
    const count = await this.getPositionCount(poolAddress, userAddress);
    const nextId = await this.getNextPositionId(poolAddress);
    const positions: LpPosition[] = [];
    for (let id = 1; id < nextId && positions.length < count; id++) {
      const position = await this.getPosition(poolAddress, id);
      if (position.owner === userAddress && position.liquidity !== '0') {
        positions.push(position);
      }
    }
    return positions;
  }

  async getNextPositionId(poolAddress: string): Promise<number> {
    const raw: unknown = await this.contractView(poolAddress, 'get_next_position_id', []);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (obj.result != null) return Number(obj.result);
    }
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') return Number(raw);
    return 1;
  }

  async getTotalLpSupply(poolAddress: string): Promise<string> {
    const raw: unknown = await this.contractView(poolAddress, 'total_lp_supply', []);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const storage = obj.storage as Record<string, string> | undefined;
      if (storage?.total_lp != null) return String(storage.total_lp);
      if (obj.result != null) return String(obj.result);
    }
    if (raw != null) return String(raw);
    return '0';
  }

  async getAllPools(factoryAddress: string): Promise<string[]> {
    const raw: unknown = await this.contractView(factoryAddress, 'all_pools', []);
    const normalize = (addr: string) => String(addr).trim();
    const valid = (addr: string) => this.isValidOctraAddress(addr);
    if (Array.isArray(raw)) return raw.map(normalize).filter(valid);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.result)) return obj.result.map(String).map(normalize).filter(valid);
      if (typeof obj.result === 'string' && obj.result.includes(',')) {
        return obj.result.split(',').map(normalize).filter(valid);
      }
      const storage = obj.storage as Record<string, string> | undefined;
      if (storage) {
        const poolLen = parseInt(storage.pools_len || '0', 10);
        if (poolLen > 0) {
          const addrs: string[] = [];
          for (let i = 0; i < poolLen; i++) {
            const addr = storage[`pools:${i}`];
            if (addr && this.isValidOctraAddress(addr)) addrs.push(addr);
          }
          if (addrs.length > 0) return addrs;
        }
        const poolKeys = Object.keys(storage).filter(k => k.startsWith('pools:') && k !== 'pools_len');
        if (poolKeys.length > 0) {
          return poolKeys
            .sort((a, b) => parseInt(a.split(':')[1], 10) - parseInt(b.split(':')[1], 10))
            .map(k => storage[k])
            .filter((addr): addr is string => !!addr && this.isValidOctraAddress(addr));
        }
      }
    }
    return [];
  }

  async hasExistingPool(factoryAddress: string, tokenA: string, tokenB: string): Promise<boolean> {
    return (await this.getPoolAddress(factoryAddress, tokenA, tokenB)) !== '';
  }

  async getPoolAddress(factoryAddress: string, tokenA: string, tokenB: string): Promise<string> {
    const direct = await this.callFactoryPoolAddress(factoryAddress, tokenA, tokenB);
    if (direct && this.isValidOctraAddress(direct)) return direct;
    if (tokenA === tokenB) return '';
    const reversed = await this.callFactoryPoolAddress(factoryAddress, tokenB, tokenA);
    return this.isValidOctraAddress(reversed) ? reversed : '';
  }

  private isValidOctraAddress(address: string): boolean {
    return /^oct[1-9A-HJ-NP-Za-km-z]{43,48}$/.test(address);
  }

  private async callFactoryPoolAddress(factoryAddress: string, tokenA: string, tokenB: string): Promise<string> {
    try {
      const raw: unknown = await this.contractView(factoryAddress, 'get_pool', [tokenA, tokenB]);
      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        if (typeof obj.result === 'string' && obj.result !== '' && obj.result !== '0') return obj.result;
        const storage = obj.storage as Record<string, string> | undefined;
        if (storage?.pool && storage.pool !== '' && storage.pool !== '0') return storage.pool;
      }
      if (typeof raw === 'string' && raw !== '' && raw !== '0') return raw;
    } catch { /* noop */ }
    return '';
  }

  async getPoolFeeParams(poolAddress: string): Promise<{ numerator: number; denominator: number; percent: string }> {
    try {
      const raw: unknown = await this.contractView(poolAddress, 'get_pool_info', []);
      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        const storage = obj.storage as Record<string, unknown> | undefined;
        if (storage) {
          const num = Number(storage.fee_numerator ?? 3);
          const denom = Number(storage.fee_denominator ?? 1000);
          return { numerator: num, denominator: denom, percent: `${(num / denom * 100).toFixed(2)}%` };
        }
      }
    } catch { /* noop */ }
    return { numerator: 3, denominator: 1000, percent: '0.30%' };
  }

  async getOesRewardsInfo(oesAddress: string): Promise<{ rewardsPerEpoch: number }> {
    try {
      const raw: unknown = await this.contractView(oesAddress, 'get_rewards_info', []);
      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        const storage = obj.storage as Record<string, unknown> | undefined;
        if (storage) {
          return { rewardsPerEpoch: Number(storage.rewards_per_epoch ?? 0) };
        }
        const arr = obj.result;
        if (Array.isArray(arr) && arr.length >= 1) {
          return { rewardsPerEpoch: Number(arr[0] ?? 0) };
        }
      }
    } catch { /* noop */ }
    return { rewardsPerEpoch: 0 };
  }

  async getTotalLockedLp(poolAddress: string): Promise<string> {
    try {
      const raw: unknown = await this.contractView(poolAddress, 'get_total_locked_lp', []);
      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        if (obj.result !== undefined) return String(obj.result);
        const storage = obj.storage as Record<string, unknown> | undefined;
        if (storage && storage.total_locked_lp !== undefined) return String(storage.total_locked_lp);
      }
      if (typeof raw === 'string') return raw;
      if (typeof raw === 'number') return String(raw);
    } catch { /* noop */ }
    return '0';
  }

  async getPoolInfo(poolAddress: string): Promise<{ tokenA: string; tokenB: string; reserveA: string; reserveB: string; totalLP: string; active: boolean }> {
    if (!this.isValidOctraAddress(poolAddress)) {
      throw new Error('Invalid pool address');
    }
    const raw: unknown = await this.contractView(poolAddress, 'get_pool_info', []);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const storage = obj.storage as Record<string, unknown> | undefined;
      if (storage) {
        const tokenA = storage.token_a as string | undefined;
        const tokenB = storage.token_b as string | undefined;
        if (tokenA && tokenB) {
          return {
            tokenA, tokenB,
            reserveA: String(storage.reserve_a ?? '0'),
            reserveB: String(storage.reserve_b ?? '0'),
            totalLP: String(storage.total_liquidity ?? storage.total_lp ?? '0'),
            active: storage.active === true || storage.active === 'true',
          };
        }
      }
      const arr = obj.result;
      if (Array.isArray(arr) && arr.length >= 6) {
        return {
          tokenA: String(arr[0]), tokenB: String(arr[1]),
          reserveA: String(arr[2] ?? '0'), reserveB: String(arr[3] ?? '0'),
          totalLP: String(arr[4] ?? '0'),
          active: arr[5] === true || arr[5] === 'true',
        };
      }
      if (typeof arr === 'string') {
        const parts = arr.split(',');
        if (parts.length >= 6) {
          return {
            tokenA: parts[0].trim(), tokenB: parts[1].trim(),
            reserveA: parts[2].trim(), reserveB: parts[3].trim(),
            totalLP: parts[4].trim(),
            active: parts[5].trim() === 'true',
          };
        }
      }
    }
    if (Array.isArray(raw) && raw.length >= 6) {
      return {
        tokenA: String(raw[0]), tokenB: String(raw[1]),
        reserveA: String(raw[2] ?? '0'), reserveB: String(raw[3] ?? '0'),
        totalLP: String(raw[4] ?? '0'),
        active: raw[5] === true || raw[5] === 'true',
      };
    }
    return { tokenA: '', tokenB: '', reserveA: '0', reserveB: '0', totalLP: '0', active: false };
  }

  async compileAml(source: string): Promise<{ bytecode: string; size: number; instructions: number }> {
    return this.call('octra_compileAml', [source]);
  }

  async computeContractAddress(bytecode: string, deployer: string, nonce: number): Promise<{ address: string }> {
    return this.call('octra_computeContractAddress', [bytecode, deployer, nonce]);
  }

  async getTrustedTokens(factoryAddress: string): Promise<string[]> {
    const cached = getCachedTrustedTokens(factoryAddress);
    if (cached) return cached;
    const raw: unknown = await this.contractView(factoryAddress, 'get_trusted_tokens', []);
    let result: string[] = [];
    if (Array.isArray(raw)) {
      result = raw.map(String);
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.result)) {
        result = obj.result.map(String);
      } else {
        const storage = obj.storage as Record<string, string> | undefined;
        if (storage) {
          const len = parseInt(storage.trusted_tokens_len || '0', 10);
          if (len > 0) {
            const addrs: string[] = [];
            for (let i = 0; i < len; i++) {
              const addr = storage[`trusted_list:${i}`];
              if (addr) addrs.push(addr);
            }
            if (addrs.length > 0) result = addrs;
          }
          if (result.length === 0) {
            const keys = Object.keys(storage).filter(k => k.startsWith('trusted_list:') && k !== 'trusted_tokens_len');
            if (keys.length > 0) {
              result = keys
                .sort((a, b) => parseInt(a.split(':')[1], 10) - parseInt(b.split(':')[1], 10))
                .map(k => storage[k]);
            }
          }
        }
      }
    }

    // Filter untuk hanya menyertakan token tepercaya yang berstatus aktif saat ini
    const filtered: string[] = [];
    for (const t of result) {
      if (t) {
        const ok = await this.isTrustedToken(factoryAddress, t);
        if (ok) filtered.push(t);
      }
    }

    setCachedTrustedTokens(factoryAddress, filtered);
    return filtered;
  }

  async isTrustedToken(factoryAddress: string, tokenAddress: string): Promise<boolean> {
    const cached = getCachedIsTrusted(factoryAddress, tokenAddress);
    if (cached !== null) return cached;
    try {
      const raw: unknown = await this.contractView(factoryAddress, 'is_trusted', [tokenAddress]);
      const obj = raw as Record<string, unknown> | undefined;
      const result = obj?.result === true || obj?.result === 'true' || raw === true || raw === 'true';
      setCachedIsTrusted(factoryAddress, tokenAddress, result);
      return result;
    } catch {
      return false;
    }
  }

  async getTokenMeta(tokenAddress: string): Promise<{ symbol: string; name: string; decimals: number }> {
    if (!tokenAddress) return { symbol: '???', name: 'Unknown', decimals: 6 };
    const cached = getCachedMeta(tokenAddress);
    if (cached) return cached;
    const defaultMeta = { symbol: tokenAddress.slice(0, 6), name: 'Unknown', decimals: 6 };
    try {
      const symRaw: unknown = await this.contractView(tokenAddress, 'get_symbol', []);
      const symbol = (symRaw && typeof symRaw === 'object' ? String((symRaw as Record<string, unknown>).result ?? '') : String(symRaw ?? ''));
      if (!symbol) return defaultMeta;
      const nameRaw: unknown = await this.contractView(tokenAddress, 'get_name', []);
      const name = (nameRaw && typeof nameRaw === 'object' ? String((nameRaw as Record<string, unknown>).result ?? '') : String(nameRaw ?? ''));
      const decRaw: unknown = await this.contractView(tokenAddress, 'decimals', []);
      const decimals = parseInt(decRaw && typeof decRaw === 'object' ? String((decRaw as Record<string, unknown>).result ?? '6') : String(decRaw ?? '6'));
      const meta = { symbol: symbol.trim(), name: name.trim(), decimals: isNaN(decimals) ? 6 : decimals };
      setCachedMeta(tokenAddress, meta);
      return meta;
    } catch {
      return defaultMeta;
    }
  }

  async waitForReceipt(txHash: string, maxRetries = 30): Promise<{ status: string; result: unknown; success: boolean }> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const receipt = await this.call<{ status: string; result: unknown; error?: string; success?: boolean }>('contract_receipt', [txHash]);
        if (receipt && receipt.status !== 'pending') {
          if (receipt.status === 'failed' || receipt.success === false) {
            throw new Error(receipt.error || 'Transaction failed');
          }
          return receipt as { status: string; result: unknown; success: boolean };
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('not found')) {
          // receipt not ready yet, retry
        } else {
          throw e;
        }
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('Transaction timeout - not confirmed after 60s');
  }

  clearCache(): void {
    clearTokenCache();
  }

  // [V6-SECURITY-FIX HIGH-9] Fix setNetwork to actually switch RPC URLs
  setNetwork(network: 'devnet' | 'mainnet'): void {
    this.url = network === 'devnet' ? 'https://devnet.octrascan.io/rpc' : 'https://octra.network/rpc';
    setTokenCacheNetwork(network);
  }
}
