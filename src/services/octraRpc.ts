import { RPC_URL as CONFIG_RPC_URL } from '../config';
import { getCachedMeta, setCachedMeta, getCachedTrustedTokens, setCachedTrustedTokens, getCachedIsTrusted, setCachedIsTrusted, clearTokenCache, setTokenCacheNetwork } from './tokenCache';

// [SECURITY] F-3: Exported helper to validate an Octra address. Applies NFKC normalization
// and strips zero-width / RTL characters to prevent homoglyph attacks.
export function isValidOctraAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  const normalized = address.normalize('NFKC').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  return /^oct[1-9A-HJ-NP-Za-km-z]{43,48}$/.test(normalized);
}

// [SECURITY] F-7: Sanitize RPC error messages to prevent injection via compromised responses
function sanitizeErrorMessage(msg: string): string {
  return String(msg)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .slice(0, 200);
}

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
      // [SECURITY] F-7: Sanitize RPC error messages before they reach the UI to prevent
      // injection from compromised RPC responses. Cap length, strip control chars.
      let json: { result?: unknown; error?: { message?: string } };
      try {
        json = await res.json();
      } catch {
        throw new Error('RPC returned invalid JSON');
      }
      if (json.error) {
        const safeMsg = sanitizeErrorMessage(json.error.message || 'RPC error');
        throw new Error(safeMsg);
      }
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
      // [V7-FIX] Validate exactly 2 parts (not >= 2 which silently ignores extra)
      if (parts.length === 2) {
        return { reserveA: parts[0].trim(), reserveB: parts[1].trim() };
      }
      throw new Error('Unexpected reserves string format (expected 2 parts): ' + raw.slice(0, 100));
    }
    // [SECURITY] FM-2: Throw on parse failure instead of silently returning '0' which
    // could trick the user into adding liquidity to an already-existing pool
    throw new Error('Failed to parse reserves for pool ' + poolAddress);
  }

  // [V7-PASS9] H-13: getTokenStatus fetches pause/blacklist/tax state from TokenV2.
  // Returns a partial status object; missing view fns are treated as "not enabled".
  async getTokenStatus(tokenAddress: string, userAddress?: string): Promise<{
    paused: boolean;
    blacklisted: boolean;
    isMintable: boolean;
    isBurnable: boolean;
    isPausable: boolean;
    isBlacklistable: boolean;
    isMaxTx: boolean;
    isMaxWallet: boolean;
    isCooldown: boolean;
    isTax: boolean;
    isAutoBurn: boolean;
  }> {
    const defaults = {
      paused: false, blacklisted: false,
      isMintable: false, isBurnable: false, isPausable: false, isBlacklistable: false,
      isMaxTx: false, isMaxWallet: false, isCooldown: false, isTax: false, isAutoBurn: false,
    };
    if (!tokenAddress) return defaults;
    try {
      const [paused, blacklisted, mintable, burnable, pausable, blacklistable,
             maxTx, maxWallet, cooldown, tax, autoBurn] = await Promise.all([
        this.contractView<unknown>(tokenAddress, 'is_paused', []),
        userAddress
          ? this.contractView<unknown>(tokenAddress, 'is_blacklisted', [userAddress])
          : Promise.resolve(false),
        this.contractView<unknown>(tokenAddress, 'is_mintable', []),
        this.contractView<unknown>(tokenAddress, 'is_burnable', []),
        this.contractView<unknown>(tokenAddress, 'is_pausable_enabled', []),
        this.contractView<unknown>(tokenAddress, 'is_blacklist_enabled', []),
        this.contractView<unknown>(tokenAddress, 'is_max_tx_enabled', []),
        this.contractView<unknown>(tokenAddress, 'is_max_wallet_enabled', []),
        this.contractView<unknown>(tokenAddress, 'is_cooldown_enabled', []),
        this.contractView<unknown>(tokenAddress, 'is_tax_enabled', []),
        this.contractView<unknown>(tokenAddress, 'is_auto_burn_enabled', []),
      ]);
      const b = (v: unknown): boolean => v === true || v === 'true' || v === 1;
      return {
        paused: b(paused),
        blacklisted: b(blacklisted),
        isMintable: b(mintable),
        isBurnable: b(burnable),
        isPausable: b(pausable),
        isBlacklistable: b(blacklistable),
        isMaxTx: b(maxTx),
        isMaxWallet: b(maxWallet),
        isCooldown: b(cooldown),
        isTax: b(tax),
        isAutoBurn: b(autoBurn),
      };
    } catch {
      return defaults;
    }
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
    // [SECURITY] F-3: Throw on parse failure instead of silently returning 0
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (obj.result != null) {
        const n = Number(obj.result);
        if (Number.isFinite(n)) return n;
        throw new Error('Invalid position count from RPC');
      }
    }
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
      throw new Error('Invalid position count from RPC');
    }
    throw new Error('Position count not available from pool ' + poolAddress);
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
        const len = parseInt(s.substring(i, hashIdx), 10);
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

  // [SECURITY] F-1: Cap loops to prevent DoS via huge nextId/count from malicious pool
  // [BUG-FIX] Position IDs are globally sequential across ALL users, not per-user.
  // A user's count=1 does NOT mean their position is at ID 1 — it could be at ID 500
  // if 499 other users created positions first. We must search up to the global
  // next_position_id, not count*2. Use count as the stop condition (found enough).
  // Cap at 5000 to prevent DoS against a pool with massive position history.
  async getPositions(poolAddress: string, userAddress: string): Promise<LpPosition[]> {
    const count = await this.getPositionCount(poolAddress, userAddress);
    if (count === 0) return [];
    // Get the global next position ID (upper bound for search)
    let maxId: number;
    try {
      maxId = await this.getNextPositionId(poolAddress);
    } catch {
      // Fallback: if we can't get next_position_id, use count * 100 as a heuristic
      maxId = count * 100;
    }
    // Cap at 5000 to prevent DoS
    const upperBound = Math.min(maxId, 5001);
    const positions: LpPosition[] = [];
    // [SECURITY] FM-8: Skip position 0 (contract doesn't have position 0)
    for (let id = 1; id < upperBound && positions.length < count; id++) {
      const position = await this.getPosition(poolAddress, id);
      if (position.owner === userAddress && position.liquidity !== '0') {
        positions.push(position);
      }
    }
    return positions;
  }

  async getNextPositionId(poolAddress: string): Promise<number> {
    const raw: unknown = await this.contractView(poolAddress, 'get_next_position_id', []);
    // [SECURITY] F-3: Throw on parse failure instead of silently returning 1
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (obj.result != null) {
        const n = Number(obj.result);
        if (Number.isFinite(n)) return n;
        throw new Error('Invalid next position ID from RPC');
      }
    }
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
      throw new Error('Invalid next position ID from RPC');
    }
    throw new Error('Next position ID not available from pool ' + poolAddress);
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
          // [SECURITY] F-2: Cap loop at 1000 to prevent DoS via huge pools_len
          const cappedPoolLen = Math.min(poolLen, 1000);
          for (let i = 0; i < cappedPoolLen; i++) {
            const addr = storage[`pools:${i}`];
            if (addr && this.isValidOctraAddress(addr)) addrs.push(addr);
          }
          if (addrs.length > 0) return addrs;
        }
        const poolKeys = Object.keys(storage).filter(k => k.startsWith('pools:') && k !== 'pools_len');
        if (poolKeys.length > 0) {
          // [SECURITY] F-2: Cap key list to 1000 to prevent DoS
          return poolKeys
            .slice(0, 1000)
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

  isValidOctraAddress(address: string): boolean {
    return isValidOctraAddress(address);
  }

  private async callFactoryPoolAddress(factoryAddress: string, tokenA: string, tokenB: string): Promise<string> {
    try {
      const raw: unknown = await this.contractView(factoryAddress, 'get_pool', [tokenA, tokenB]);
      // [V7-FIX] Reject all falsy/placeholder values from various RPC versions
      const isValidResult = (s: string) => s && s !== '' && s !== '0' && s !== 'null' && s !== 'undefined';
      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        if (typeof obj.result === 'string' && isValidResult(obj.result)) return obj.result;
        const storage = obj.storage as Record<string, string> | undefined;
        if (storage?.pool && isValidResult(storage.pool)) return storage.pool;
      }
      if (typeof raw === 'string' && isValidResult(raw)) return raw;
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

  // [V9] checkPoolLiquiditySupport: pre-flight probe for add_liquidity readiness.
  // The single most common cause of the opaque "Add Liquidity Failed / execution
  // reverted" error on everestswap is a misconfigured pool `factory` address —
  // either `set_factory` was never called (factory = origin sentinel) or was set
  // to a non-deployed / non-AMM-aware address. The pool's `add_liquidity` does
  // `require(call(self.factory, "validate_initial_price", ...))` on first add,
  // which silently returns false when factory bytecode is missing, causing the
  // whole tx to revert with no actionable detail in the UI.
  //
  // This probe runs as a read-only `contract_call` against the stored factory
  // and returns a structured diagnosis the UI can render before the user signs.
  //
  // [V9-PERF] Cache results per poolAddress — loadPoolInfo re-runs every 10s,
  // so without caching we'd fire 6+ RPC calls/min per kept-open Liquidity tab.
  // Cache invalidates on setNetwork().
  private _poolSupportCache: Map<string, { result: { ok: boolean; factory: string; factoryOk: boolean; tokensOk: boolean; reservesZero: boolean; error?: string }; ts: number }> = new Map();
  private static readonly POOL_SUPPORT_TTL_MS = 60_000;
  async checkPoolLiquiditySupport(poolAddress: string): Promise<{
    ok: boolean;
    factory: string;
    factoryOk: boolean;
    tokensOk: boolean;
    reservesZero: boolean;
    error?: string;
  }> {
    // [V9-PERF] Cached hit (within TTL) — return immediately.
    const cached = this._poolSupportCache.get(poolAddress);
    if (cached && Date.now() - cached.ts < OctraRpc.POOL_SUPPORT_TTL_MS) {
      return cached.result;
    }
    // [TYPE-FIX] `out.error = …` below requires `base` (and therefore every
    // `{ ...base, ... }` / `{ ...out, ... }` spread) to carry an `error?: string`
    // field. Cast `undefined` to `string | undefined` so TS infers the optional
    // string field rather than widening to `{}` (which would defeat the type).
    const base = { ok: false, factory: '', factoryOk: false, tokensOk: false, reservesZero: false, error: undefined as string | undefined };
    try {
      const raw = await this.contractView<unknown>(poolAddress, 'get_pool_info', []);
      if (!raw || typeof raw !== 'object') {
        return { ...base, error: 'pool_get_pool_info_failed' };
      }
      const obj = raw as Record<string, unknown>;
      const storage = obj.storage as Record<string, unknown> | undefined;
      if (!storage) {
        return { ...base, error: 'pool_storage_unavailable' };
      }
      const factory = String(storage.factory ?? '');
      const tokenA = String(storage.token_a ?? '');
      const tokenB = String(storage.token_b ?? '');
      const reserveA = String(storage.reserve_a ?? '0');
      const reserveB = String(storage.reserve_b ?? '0');
      const reservesZero = reserveA === '0' && reserveB === '0';
      const factoryValid = !!factory && factory !== '' && factory !== '0' && factory !== 'origin';
      const tokensSet = !!tokenA && !!tokenB && tokenA !== '' && tokenB !== '' && tokenA !== 'origin' && tokenB !== 'origin';
      const out = { ...base, factory: factoryValid ? factory : '', reservesZero };
      if (!tokensSet) {
        return { ...out, error: 'pool_tokens_not_set' };
      }
      if (!factoryValid) {
        return { ...out, error: 'pool_factory_unset' };
      }
      // Probe stored factory: if it has no bytecode (wrong addr or undo deploy),
      // contract_call throws with "bytecode not found". If factory doesn't
      // implement `validate_initial_price`, it reverts. Either failure means
      // the pool's add_liquidity will revert with "equilibrium price check failed".
      try {
        const probeResult = await this.contractView<unknown>(factory, 'validate_initial_price', [tokenA, tokenB, '1000000', '1000000']);
        const inner = probeResult && typeof probeResult === 'object'
          ? (probeResult as Record<string, unknown>).result
          : probeResult;
        out.factoryOk = inner === true || inner === 'true' || inner === 1;
      } catch {
        return { ...out, factoryOk: false, error: 'factory_callback_invalid' };
      }
      out.tokensOk = true;
      out.ok = out.factoryOk;
      if (!out.ok) {
        out.error = out.error || 'factory_callback_returns_false';
      }
      return out;
    } catch (e) {
      const result = { ...base, error: e instanceof Error ? e.message : 'probe_failed' };
      // [V9-PERF] Cache the resolved result (including error) so we don't keep
      // hitting a broken factory every 10s.
      this._poolSupportCache.set(poolAddress, { result, ts: Date.now() });
      return result;
    }
  }

  /** [V9-PERF] Invalidate cached pool-support probes (e.g. on network switch). */
  clearPoolSupportCache(): void {
    this._poolSupportCache.clear();
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

  async getRecommendedFee(opType: string): Promise<{ minimum: string; recommended: string; fast: string }> {
    const raw: unknown = await this.call('octra_recommendedFee', [opType]);
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      return {
        minimum: String(obj.minimum ?? '10000'),
        recommended: String(obj.recommended ?? '100000'),
        fast: String(obj.fast ?? '200000'),
      };
    }
    return { minimum: '10000', recommended: '100000', fast: '200000' };
  }

  async compileAml(source: string): Promise<{ bytecode: string; size: number; instructions: number }> {
    return this.call('octra_compileAml', [source]);
  }

  async computeContractAddress(bytecode: string, deployer: string, nonce: number): Promise<{ address: string }> {
    // [SECURITY] L-1: Validate bytecode is non-empty
    if (!bytecode || typeof bytecode !== 'string' || bytecode.length === 0) {
      throw new Error('computeContractAddress: bytecode is required');
    }
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
            // [SECURITY] F-3: Cap loop at 1000 to prevent DoS via huge trusted_tokens_len
            const cappedLen = Math.min(len, 1000);
            for (let i = 0; i < cappedLen; i++) {
              const addr = storage[`trusted_list:${i}`];
              if (addr) addrs.push(addr);
            }
            if (addrs.length > 0) result = addrs;
          }
          if (result.length === 0) {
            const keys = Object.keys(storage).filter(k => k.startsWith('trusted_list:') && k !== 'trusted_tokens_len');
            if (keys.length > 0) {
              result = keys
                .slice(0, 1000)
                .sort((a, b) => parseInt(a.split(':')[1], 10) - parseInt(b.split(':')[1], 10))
                .map(k => storage[k]);
            }
          }
        }
      }
    }

    // [V7-FIX] Use bounded concurrency to avoid N sequential RPC calls (UI freeze
    // with 20+ tokens). Process in batches of 5.
    const filtered: string[] = [];
    const CONCURRENCY = 5;
    const tokens = result.filter((t): t is string => !!t);
    for (let i = 0; i < tokens.length; i += CONCURRENCY) {
      const batch = tokens.slice(i, i + CONCURRENCY);
      const checks = await Promise.all(
        batch.map(async t => ({ token: t, ok: await this.isTrustedToken(factoryAddress, t) }))
      );
      for (const { token, ok } of checks) {
        if (ok) filtered.push(token);
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

  // [SECURITY] Safely extract string result from RPC response
  private extractString(raw: unknown): string {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const val = obj.result;
      if (val != null && typeof val !== 'object') return String(val).trim();
    }
    if (raw != null && typeof raw !== 'object') return String(raw).trim();
    return '';
  }

  // [SECURITY] Safely extract number result from RPC response
  private extractNumber(raw: unknown, defaultVal: number): number {
    const s = this.extractString(raw);
    if (!s) return defaultVal;
    const n = parseInt(s, 10);
    return isNaN(n) ? defaultVal : n;
  }

  async getTokenMeta(tokenAddress: string): Promise<{ symbol: string; name: string; decimals: number }> {
    if (!tokenAddress) return { symbol: '???', name: 'Unknown', decimals: 6 };
    const cached = getCachedMeta(tokenAddress);
    if (cached) return cached;
    const defaultMeta = { symbol: tokenAddress.slice(0, 6), name: 'Unknown', decimals: 6 };
    try {
      const symRaw: unknown = await this.contractView(tokenAddress, 'get_symbol', []);
      let symbol = this.extractString(symRaw);
      if (!symbol) return defaultMeta;
      // [SECURITY] Clamp symbol length to prevent layout breakage
      if (symbol.length > 12) symbol = symbol.slice(0, 12);
      const nameRaw: unknown = await this.contractView(tokenAddress, 'get_name', []);
      let name = this.extractString(nameRaw);
      if (name.length > 40) name = name.slice(0, 40);
      const decRaw: unknown = await this.contractView(tokenAddress, 'decimals', []);
      let decimals = this.extractNumber(decRaw, 6);
      // [SECURITY] Clamp decimals to 0-18 range
      decimals = Math.max(0, Math.min(18, decimals));
      const meta = { symbol, name, decimals };
      setCachedMeta(tokenAddress, meta);
      return meta;
    } catch {
      return defaultMeta;
    }
  }

  // [SECURITY] FM-3: Accept an optional AbortSignal to cancel polling on unmount
  async waitForReceipt(txHash: string, maxRetries = 30, signal?: AbortSignal): Promise<{ status: string; result: unknown; success: boolean }> {
    for (let i = 0; i < maxRetries; i++) {
      if (signal?.aborted) {
        throw new Error('Receipt polling aborted');
      }
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
      // Sleep with abort awareness
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 2000);
        if (signal) {
          const onAbort = () => { clearTimeout(t); reject(new Error('Receipt polling aborted')); };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
    // [V7-PASS10] HIGH-12: include tx hash in timeout error so callers can
    // link to explorer for manual check
    throw new Error(`Transaction ${txHash} not confirmed after 60s — check explorer for status`);
  }

  // [V8] Trust rating — voting RPC methods

  async voteToken(factoryAddress: string, tokenAddress: string): Promise<string> {
    const { walletService } = await import('./walletService');
    if (!walletService.address) throw new Error('Wallet not connected');
    return walletService.callContract({ contract: factoryAddress, method: 'vote_token', params: [tokenAddress] });
  }

  async unvoteToken(factoryAddress: string, tokenAddress: string): Promise<string> {
    const { walletService } = await import('./walletService');
    if (!walletService.address) throw new Error('Wallet not connected');
    return walletService.callContract({ contract: factoryAddress, method: 'unvote_token', params: [tokenAddress] });
  }

  async getTokenVotes(factoryAddress: string, tokenAddress: string): Promise<number> {
    try {
      const raw: unknown = await this.contractView(factoryAddress, 'get_token_votes', [tokenAddress]);
      return this.extractNumber(raw, 0);
    } catch {
      return 0;
    }
  }

  async hasVoted(factoryAddress: string, voterAddress: string, tokenAddress: string): Promise<boolean> {
    try {
      const raw: unknown = await this.contractView(factoryAddress, 'has_voted', [voterAddress, tokenAddress]);
      const obj = raw as Record<string, unknown> | undefined;
      return obj?.result === true || obj?.result === 'true' || raw === true || raw === 'true';
    } catch {
      return false;
    }
  }

  async getTokenOwner(tokenAddress: string): Promise<string> {
    try {
      const raw: unknown = await this.contractView(tokenAddress, 'get_owner', []);
      return this.extractString(raw);
    } catch {
      return '';
    }
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
