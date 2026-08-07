import { ZeroXIOWallet, type TransactionHistory, type ContractParams } from '@0xio/sdk';
import { OctraRpc } from './octraRpc';
import { ORION_WALLET_URL, NETWORK } from '../config';
import { OrionWalletClient, clearOrionSessionHint } from './orionWallet';

// ── Wallet provider selection ───────────────────────────────────────────────
// EverestSwap supports two very different wallets:
//   - 0xio: a browser extension injected at `window.octra`, which signs AND
//     broadcasts (via the @0xio/sdk).
//   - Orion: a web-app wallet reached via a popup + MessageChannel, which
//     signs only and refuses to broadcast by design — the dApp submits the
//     signed tx through its own RPC.
// The active provider is chosen by the user and persisted so a reload restores
// the same one.

export type WalletKind = '0xio' | 'orion';

const WALLET_KIND_KEY = 'everestswap_wallet_kind';

let activeKind: WalletKind = readStoredKind();

function readStoredKind(): WalletKind {
  try {
    return localStorage.getItem(WALLET_KIND_KEY) === 'orion' ? 'orion' : '0xio';
  } catch {
    return '0xio';
  }
}

export function getWalletKind(): WalletKind {
  return activeKind;
}

export function setWalletKind(kind: WalletKind): void {
  activeKind = kind;
  try {
    localStorage.setItem(WALLET_KIND_KEY, kind);
  } catch {
    /* quota / private-mode */
  }
}

/** Whether the 0xio extension is present, regardless of the active provider. */
export function is0xioInstalled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as {
      octra?: { isOctra?: boolean };
      wallet0xio?: unknown;
      ZeroXIOWallet?: unknown;
    };
    return !!(w.octra?.isOctra || w.wallet0xio || w.ZeroXIOWallet);
  } catch {
    return false;
  }
}

// [V7-FIX] Fee cache: avoid repeated RPC calls for the same op_type
const _feeCache = new Map<string, { ou: string; ts: number }>();
const FEE_CACHE_TTL = 30_000; // 30s

// [FIX-POPUP] Hard ceiling for any interactive wallet popup (sign/deposit/grant/etc).
// The 0xio SDK's default interactive timeout is 180s — far too long to leave a user
// staring at a "sign..." spinner when the extension's popup never actually surfaced
// (a known symptom of cold-extension races / locked windows / MV3 service-worker
// restarts). Racing the popup submission against this ceiling lets the UI surface a
// clear, actionable error much sooner instead of hanging silently.
const WALLET_POPUP_TIMEOUT_MS = 60_000;

// [FIX-POPUP] Pure timeout race — exported for unit tests (which can't reach the
// private method on the singleton due to module-load side effects). Resolves with
// p's value if p settles before ms; otherwise rejects with Error(timeoutMsg).
export function raceWithTimeout<T>(p: Promise<T>, ms: number, timeoutMsg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(timeoutMsg));
    }, ms);
    p.then(
      (v) => { if (!settled) { settled = true; clearTimeout(t); resolve(v); } },
      (e) => { if (!settled) { settled = true; clearTimeout(t); reject(e); } },
    );
  });
}

async function fetchRecommendedOu(rpc: OctraRpc, opType: string): Promise<string> {
  const now = Date.now();
  const cached = _feeCache.get(opType);
  if (cached && now - cached.ts < FEE_CACHE_TTL) return cached.ou;
  try {
    const fee = await rpc.getRecommendedFee(opType);
    const ou = fee.recommended || '100000';
    _feeCache.set(opType, { ou, ts: now });
    return ou;
  } catch {
    return cached?.ou || '100000';
  }
}

export class WalletService {
  // [FIX-POPUP-REWRITE] Follows the README quick-start pattern exactly.
  // Earlier fixes forced `adapter: OctraProviderAdapter`, but per the SDK docs:
  //   "ZeroXIOAdapter — detected via window.wallet0xio / window.ZeroXIOWallet
  //    (postMessage bridge). Priority when the 0xio extension is installed."
  // Forcing OctraProviderAdapter against the 0xio extension routes popups
  // through `window.octra.request('octra_sendContractTransaction', ...)` which
  // the extension does not surface as a popup — this is the most likely reason
  // popups never appear. We now omit `adapter` and let the SDK auto-detect
  // (ZeroXIOAdapter wins when the 0xio extension is present). This matches the
  // official Quick Start:
  //   const wallet = new ZeroXIOWallet({ appName, requiredPermissions });
  // We also drop the custom readiness-event/rebuild machinery: the SDK's own
  // `initialize()` polls for extension availability (listenForReady) and attaches
  // provider listeners when the adapter eventually fires `0xioWalletReady` /
  // `wallet0xioReady`, both of which are still emitted by v2.7.0. Rebuilding the
  // SDK ourselves only re-introduced races (cleanup() aborts in-flight popups).
  private sdk: ZeroXIOWallet;
  private rpc!: OctraRpc;
  private _address = '';
  private _balance = '';
  private _publicKey = '';
  // Lazily-created Orion client; only instantiated when Orion is the active
  // provider (see getOrion()). Null until the user picks Orion.
  private _orion: OrionWalletClient | null = null;
  // [V7-PASS10] CRITICAL-2: global per-address submit mutex.
  // NOTE: despite the per-address framing, _submitLock is a single global FIFO
  // queue — only ONE submit (any address) is in flight at a time across the
  // whole app. Two wallet tabs on the same user race here, which is the
  // intended nonce-protection behaviour. Don't be fooled by the "per-address"
  // wording: there is exactly one shared lock.
  private _submitLock: Promise<void> = Promise.resolve();
  private _inFlightSubmit: { address: string; nonce: number } | null = null;

  constructor() {
    this.sdk = new ZeroXIOWallet({
      appName: 'EverestSwap',
      requiredPermissions: ['read_balance', 'send_transactions', 'read_public_key'],
    });
    this.setupAccountChangeListener();
    // Best-effort fire-and-forget initialize — the SDK's initialize() polls for
    // extension availability and is the canonical readiness signal; calling it
    // early means the first connect()/callContract() sees a primed SDK. Errors
    // (extension not yet installed) are tolerated: connect() will retry.
    if (typeof window !== 'undefined') {
      this.sdk.initialize().catch(() => { /* extension not ready yet */ });
    }
  }

  setRpc(rpc: OctraRpc): void {
    this.rpc = rpc;
  }

  // ── Wallet-kind accessors ──────────────────────────────────────────────────
  get kind(): WalletKind {
    return activeKind;
  }

  setKind(kind: WalletKind): void {
    setWalletKind(kind);
  }

  /** Lazily create the Orion client the first time Orion is used. */
  private getOrion(): OrionWalletClient {
    if (!this._orion) this._orion = new OrionWalletClient(ORION_WALLET_URL, NETWORK);
    return this._orion;
  }

  /** The live Orion client, or null when Orion is not the active provider. */
  getOrionClient(): OrionWalletClient | null {
    return activeKind === 'orion' ? this.getOrion() : null;
  }

  private setupAccountChangeListener(): void {
    try {
      this.sdk.on('accountChanged', (event) => {
        const data = event.data;
        if (data?.newAddress && data.newAddress !== this._address) {
          const prev = this._address;
          this._address = data.newAddress;
          if (data.publicKey) this._publicKey = data.publicKey;
          try {
            window.dispatchEvent(new CustomEvent('wallet-account-changed', {
              detail: { address: data.newAddress, prevAddress: prev },
            }));
          } catch { /* noop */ }
        }
      });
    } catch { /* SDK may not support events in all environments */ }

    // [FIX] Sync SDK disconnect/extension-lock state into the app so the UI
    // shows "Connect Wallet" instead of failing later with a cryptic
    // "Wallet not connected. Call connect() first." error from the SDK.
    try {
      this.sdk.on('extensionLocked', () => this.clearDisconnectedState());
    } catch { /* noop */ }
    try {
      this.sdk.on('disconnect', () => this.clearDisconnectedState());
    } catch { /* noop */ }
  }

  // [FIX] The SDK resets connectionInfo.isConnected when the extension locks
  // or disconnects, but our _address would remain set. Clear it and notify the
  // UI (AppContext listens for wallet-account-changed) so the app re-syncs.
  private clearDisconnectedState(): void {
    if (this._address === '') return;
    const prev = this._address;
    this._address = '';
    this._balance = '';
    this._publicKey = '';
    try {
      window.dispatchEvent(new CustomEvent('wallet-account-changed', {
        detail: { address: '', prevAddress: prev },
      }));
    } catch { /* noop */ }
  }

  // [V7-PASS10] CRITICAL-2: Acquire the global submit lock.
  // Returns a release function. Despite taking `address`, the underlying
  // implementation is a SINGLE global FIFO queue (see the constructor docstring)
  // — only one submit of ANY address is in flight at a time. This is the nonce
  // protection intended by the audit; do not "fix" it into per-address
  // concurrency or duplicate nonce submits ensue.
  async acquireSubmitLock(address: string): Promise<() => void> {
    // Wait for the current lock holder
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    const previous = this._submitLock;
    this._submitLock = next;
    await previous;
    // Yield a microtask so concurrent callers get serialized
    return () => {
      release();
      // If a stale _inFlightSubmit exists for this address, clear it
      if (this._inFlightSubmit && this._inFlightSubmit.address === address) {
        this._inFlightSubmit = null;
      }
    };
  }

  // [V7-PASS10] CRITICAL-2: Track the next expected nonce for an address.
  // Returns the stored nonce if one is pending, otherwise null.
  getPendingNonce(address: string): number | null {
    if (this._inFlightSubmit && this._inFlightSubmit.address === address) {
      return this._inFlightSubmit.nonce;
    }
    return null;
  }

  // [V7-PASS10] CRITICAL-2: Reserve a nonce for an address before submit.
  setPendingNonce(address: string, nonce: number): void {
    this._inFlightSubmit = { address, nonce };
  }

  get isConnected(): boolean {
    return this._address !== '';
  }

  get address(): string {
    return this._address;
  }

  get balance(): string {
    return this._balance;
  }

  async isInstalled(): Promise<boolean> {
    try {
      if (typeof window === 'undefined') return false;
      // Orion is a web app reached by popup, so there is nothing to detect on
      // `window` — it is always "available" as long as popups are permitted.
      if (activeKind === 'orion') return true;
      return is0xioInstalled();
    } catch {
      return false;
    }
  }

  async connect(): Promise<string> {
    if (activeKind === 'orion') {
      const orion = this.getOrion();
      const result = await orion.connect();
      const addr = result?.address;
      if (typeof addr === 'string' && /^oct[1-9A-HJ-NP-Za-km-z]{20,}$/.test(addr)) {
        this._address = addr;
        if (result.publicKey) this._publicKey = result.publicKey;
        const bal = await this.rpc.call<{ balance: string; balance_raw: string; nonce: number }>('octra_balance', [this._address]);
        this._balance = bal?.balance || '0';
        return this._address;
      }
      throw new Error('Orion Wallet returned no address');
    }
    try {
      await this.sdk.initialize();
    } catch {
      throw new Error('0xio wallet not installed');
    }
    const result = await this.sdk.connect({
      requestPermissions: ['read_balance', 'send_transactions', 'read_public_key'],
    });
    this._address = result.address;
    if (result.publicKey) this._publicKey = result.publicKey;
    const bal = await this.rpc.call<{ balance: string; balance_raw: string; nonce: number }>('octra_balance', [this._address]);
    this._balance = bal?.balance || '0';
    return this._address;
  }

  async disconnect(): Promise<void> {
    if (this._orion) {
      try {
        await this._orion.disconnect();
      } catch {
        /* Ignore disconnect errors */
      }
      this._orion = null;
    }
    clearOrionSessionHint();
    if (typeof window !== 'undefined' && activeKind !== 'orion') {
      try {
        await this.sdk.disconnect();
      } catch {
        /* Ignore disconnect errors */
      }
    }
    this._address = '';
    this._balance = '';
    this._publicKey = '';
  }

  async getBalance(): Promise<string> {
    if (!this._address) throw new Error('Not connected');
    const bal = await this.rpc.call<{ balance: string; balance_raw: string; nonce: number }>('octra_balance', [this._address]);
    this._balance = bal?.balance || '0';
    return this._balance;
  }

  async getTransactionHistory(page = 1, limit = 20): Promise<TransactionHistory> {
    if (!this._address) throw new Error('Not connected');
    // Orion has no transaction history method; 0xio-only
    if (activeKind === 'orion') {
      throw new Error('Transaction history is not available for Orion Wallet');
    }
    return this.sdk.getTransactionHistory(page, limit);
  }

  async signMessage(message: string): Promise<{ signature: string; publicKey?: string }> {
    if (activeKind === 'orion') {
      const orion = this.getOrion();
      if (!orion.isConnected()) throw new Error('Orion Wallet is not connected');
      const result = await orion.signMessage(message, 'raw');
      if (!result?.signature) throw new Error('Signing rejected');
      return { signature: result.signature, publicKey: result.publicKey };
    }
    const octra = (window as unknown as { octra: { request: (opts: { method: string; params?: unknown }) => Promise<unknown> } }).octra;
    if (!octra) throw new Error('0xio wallet not found');
    // [FIX-POPUP] Signing is interactive too — race against the popup ceiling so
    // a silent extension does not strand a deploy in mid-sign forever.
    const wrapped = (method: string, params: unknown) =>
      this.racePopup(Promise.resolve(octra.request({ method, params })), 'Wallet tidak merespons saat sign — pastikan popup tidak tertutup');
    try {
      const result = await wrapped('octra_signMessage', [message]);
      if (typeof result === 'string') return { signature: result };
      if (result && typeof result === 'object') {
        const sig = (result as Record<string, unknown>).signature;
        const publicKey = (result as Record<string, unknown>).publicKey;
        if (typeof sig === 'string') {
          return { signature: sig, publicKey: typeof publicKey === 'string' ? publicKey : undefined };
        }
      }
    } catch { /* fallthrough to alt method */ }
    try {
      const result = await wrapped('octra_sign', { message });
      if (typeof result === 'string') return { signature: result };
    } catch { /* fallthrough to throw below */ }
    throw new Error('Signing rejected or method not supported by wallet');
  }

  async getPublicKey(): Promise<string> {
    if (activeKind === 'orion') {
      const orion = this.getOrion();
      return orion.getPublicKey() || '';
    }
    if (this._publicKey) return this._publicKey;
    try {
      const info = this.sdk.getConnectionInfo();
      if (info?.publicKey) {
        this._publicKey = info.publicKey;
        return this._publicKey;
      }
    } catch { /* noop */ }
    const octra = (window as unknown as { octra: { request: (opts: { method: string; params?: unknown }) => Promise<unknown> } }).octra;
    if (octra) {
      try {
        const result = await octra.request({ method: 'octra_getPublicKey', params: [this._address] });
        if (typeof result === 'string' && result) {
          this._publicKey = result;
          return this._publicKey;
        }
      } catch { /* noop */ }
      try {
        const result = await octra.request({ method: 'octra_publicKey', params: [this._address] });
        if (typeof result === 'string' && result) {
          this._publicKey = result;
          return this._publicKey;
        }
      } catch { /* noop */ }
    }
    return '';
  }

  // [FIX] Restore the SDK's connection state before retrying a call.
  // The SDK's internal isConnected can go stale (extension locked/disconnected)
  // while our _address still looks valid. getConnectionStatus() is a silent
  // RPC — it only prompts via connect() when the extension truly has no session.
  private async ensureSdkConnected(): Promise<boolean> {
    try {
      await this.sdk.getConnectionStatus();
      if (this.sdk.isConnected()) return true;
    } catch { /* fall through to full connect() */ }
    if (!this.sdk.isConnected()) {
      try {
        await this.connect();
      } catch {
        return false;
      }
    }
    return this.sdk.isConnected();
  }

  private isConnectionRefusedError(e: unknown): boolean {
    const err = e as { code?: string; message?: string };
    return err?.code === 'CONNECTION_REFUSED'
      || /Wallet not connected|not connected|Call connect\(\) first/i.test(err?.message || '');
  }

  // [FIX-POPUP] The 0xio SDK throws RATE_LIMIT_EXCEEDED ("Another approval
  // popup is already open") when an interactive request fires before a prior
  // popup's response drained. Most often the "prior popup" is a stray one from
  // a previous tab/attempt that the extension still considers open. Rather
  // than surface that cryptic message, we wait briefly for the SDK's
  // _interactiveInFlight flag to release and retry exactly once.
  private isPopupBlockedError(e: unknown): boolean {
    const err = e as { code?: string; message?: string };
    return err?.code === 'RATE_LIMIT_EXCEEDED'
      || /another approval popup is already open|approval popup is already open/i.test(err?.message || '');
  }

  async callContract(params: {
    contract: string;
    method: string;
    params: ContractParams;
    amount?: string | number;
    ou?: string | number;
    rpc?: OctraRpc;
  }): Promise<string> {
    if (!params.ou && params.rpc) {
      params.ou = await fetchRecommendedOu(params.rpc, 'call');
    }

    // ── Orion path: sign via the wallet popup, then submit through our RPC. ─
    if (activeKind === 'orion') {
      const orion = this.getOrion();
      if (!orion.isConnected()) throw new Error('Orion Wallet is not connected');
      // Proactively detect an expired session before the sign attempt. Without
      // this check, the request goes out over a dead port and times out after
      // 180s, surfacing as a confusing "Swap failed" toast instead of the
      // actionable "Session expired" message.
      if (!orion.isSessionAlive()) {
        throw new Error('Orion Wallet session has expired. Please reconnect and try again.');
      }
      // Orion signs the exact ou we pass (it does not backfill a recommended
      // fee like the 0xio SDK does). Callers such as vote/unvote invoke
      // callContract without `ou` OR `rpc`, so resolve one here from any
      // available RPC, falling back to a safe flat fee. Never forward an empty
      // or "undefined" ou — the node would reject the tx.
      let orionOu: string;
      if (params.ou !== undefined && params.ou !== null && String(params.ou) !== '') {
        orionOu = String(params.ou);
      } else {
        const feeRpc = params.rpc ?? this.rpc;
        orionOu = feeRpc ? await fetchRecommendedOu(feeRpc, 'call') : '100000';
      }
      const signedResult = await orion.signContract({
        program: params.contract,
        method: params.method,
        args: (params.params as unknown[]) || [],
        amount: typeof params.amount === 'string' ? params.amount : String(params.amount ?? '0'),
        ou: orionOu,
      });
      const signedTx = signedResult.signedTransaction;
      const submitRpc = params.rpc ?? this.rpc;
      if (!submitRpc) throw new Error('RPC not configured');
      const res = await submitRpc.call<{ tx_hash?: string; hash?: string } | string>('octra_submit', [signedTx]);
      const hash = typeof res === 'string' ? res : (res?.tx_hash || res?.hash || '');
      if (!hash) throw new Error('Submit succeeded but no tx_hash returned');
      return hash;
    }

    const sdkParams = { contract: params.contract, method: params.method, params: params.params, amount: params.amount, ou: params.ou };

    const submit = async (): Promise<string> => {
      // [FIX-POPUP] Race the popup against the ceiling so the user gets an
      // actionable error instead of an invisible 180s hang.
      const result = await this.racePopup(
        this.sdk.callContract(sdkParams),
        'Wallet extension tidak merespons — pastikan popup tidak tertutup/terkunci',
      );
      const resultObj = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
      const txHash = typeof resultObj.hash === 'string' ? resultObj.hash
        : typeof resultObj.txHash === 'string' ? resultObj.txHash
        : typeof resultObj.tx_hash === 'string' ? resultObj.tx_hash
        : undefined;
      if (!txHash) {
        throw new Error('Submit succeeded but no tx_hash returned');
      }
      return txHash;
    };

    try {
      return await submit();
    } catch (e) {
      // [FIX] SDK connection state can be stale (extension locked/disconnected)
      // even though our _address is still set. Restore it and retry once.
      if (this.isConnectionRefusedError(e)) {
        if (await this.ensureSdkConnected()) {
          return await submit();
        }
        throw new Error('Wallet connection lost. Please reconnect your wallet and try again.', { cause: e });
      }
      // [FIX-POPUP] Retry once after a short wait if the SDK complains a prior
      // popup is still open (RATE_LIMIT_EXCEEDED). This is the most common
      // symptom when a stuck grant popup from a previous attempt is still
      // registered as in-flight in the SDK's internal lock.
      if (this.isPopupBlockedError(e)) {
        await new Promise(r => setTimeout(r, 1500));
        return await submit();
      }
      throw e;
    }
  }

  // [FIX-POPUP] Race any interactive wallet promise against a visible timeout.
  // The first to settle wins; on timeout we reject with an actionable message.
  private racePopup<T>(p: Promise<T>, timeoutMsg: string): Promise<T> {
    return raceWithTimeout(p, WALLET_POPUP_TIMEOUT_MS, timeoutMsg);
  }

  // [FIX] Use SDK's signTransaction to fix "invalid signature" error on deploy.
  // The wallet extension builds the canonical JSON internally for signTransaction,
  // which the chain trusts. Manual canonical JSON + signMessage produces invalid signatures.
  async signAndSubmitDeployTx(
    rpc: OctraRpc,
    params: {
      bytecode: string;
      contractAddress?: string;
      poolAddress?: string;
      feeOu?: string;
      message?: string;
      nonce?: number;
    }
  ): Promise<string> {
    // [ORION] The canonical-JSON deploy path builds the tx by hand and signs
    // through the 0xio provider. Orion has no deploy op in its protocol, so
    // fail explicitly rather than signing with a wallet the user did not
    // select. (No caller in EverestSwap currently reaches this — pool/token
    // creation goes through factory.callContract.)
    if (activeKind === 'orion') {
      throw new Error('Contract deployment is not supported by Orion Wallet — switch to 0xio Wallet');
    }
    const targetAddress = params.contractAddress ?? params.poolAddress;
    if (!targetAddress) throw new Error('contractAddress or poolAddress required');
    params = { ...params, contractAddress: targetAddress };
    const address = this._address;
    if (!address) throw new Error('Not connected');
    const addressSnapshot = address;

    const releaseLock = await this.acquireSubmitLock(addressSnapshot);
    try {
      // Use pre-fetched nonce or fetch fresh
      let nonce: number;
      if (typeof params.nonce === 'number' && Number.isFinite(params.nonce) && params.nonce > 0) {
        nonce = params.nonce;
      } else {
        const balance = await rpc.getBalance(addressSnapshot);
        nonce = balance.nonce + 1;
      }
      this.setPendingNonce(addressSnapshot, nonce);

      const ou = params.feeOu || '100000';
      let timestamp = Date.now() / 1000;
      // Ensure fractional part — chain requires float timestamps
      if (timestamp % 1 === 0) timestamp += 0.000001;

      // Build canonical fields in the exact order the chain expects:
      // from, to_, amount, nonce, ou, timestamp, op_type, encrypted_data, message?
      const canonicalData: Record<string, unknown> = {
        from: addressSnapshot,
        to_: targetAddress,
        amount: '0',
        nonce,
        ou,
        timestamp,
        op_type: 'deploy',
        encrypted_data: params.bytecode,
      };
      if (params.message) canonicalData.message = params.message;

      // JSON.stringify guarantees the canonical JSON matches the chain's
      // reconstruction exactly — both use the same algorithm on the same values.
      const canonicalJson = JSON.stringify(canonicalData);
      const sigResult = await this.signMessage(canonicalJson);

      // [V9] Some wallet accounts return publicKey, others don't.
      // Fetch it explicitly so the chain can verify the signature.
      const publicKey = sigResult.publicKey || await this.getPublicKey();

      // Verify wallet hasn't changed during signing
      if (this._address !== addressSnapshot) {
        throw new Error('Wallet changed during deploy — aborting');
      }

      const signedTx: Record<string, unknown> = {
        ...canonicalData,
        signature: sigResult.signature,
      };
      if (publicKey) signedTx.public_key = publicKey;

      // Verify wallet hasn't changed during signing
      if (this._address !== addressSnapshot) {
        throw new Error('Wallet changed during deploy — aborting');
      }

      // Submit with nonce-retry logic
      const submitSigned = async (tx: Record<string, unknown>): Promise<string> => {
        const res = await rpc.call<{ tx_hash: string; status: string; nonce: number; ou_cost: string }>('octra_submit', [tx]);
        if (!res.tx_hash) throw new Error('Submit succeeded but no tx_hash returned');
        return res.tx_hash;
      };

      try {
        return await submitSigned(signedTx as Record<string, unknown>);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (/nonce too low|invalid nonce|nonce.*low/i.test(errMsg)) {
          // Refetch nonce and retry once
          const fresh = await rpc.getBalance(addressSnapshot);
          const retryNonce = fresh.nonce + 1;
          this.setPendingNonce(addressSnapshot, retryNonce);

          // CRITICAL: Recompute contract address with the new nonce
          // The original targetAddress was computed with the old nonce,
          // but the chain will deploy bytecode at an address derived
          // from the new nonce. Without this fix, the retry deploys
          // to a different address than what the caller expects.
          const retryAddrResult = await rpc.computeContractAddress(
            params.bytecode, addressSnapshot, retryNonce
          );
          const retryTargetAddress = retryAddrResult.address;

          // Re-sign with new nonce using same JSON.stringify approach
          const retryData: Record<string, unknown> = {
            from: addressSnapshot,
            to_: retryTargetAddress,
            amount: '0',
            nonce: retryNonce,
            ou,
            timestamp,
            op_type: 'deploy',
            encrypted_data: params.bytecode,
          };
          if (params.message) retryData.message = params.message;
          const retryCanonicalJson = JSON.stringify(retryData);
          const retrySig = await this.signMessage(retryCanonicalJson);
          // Verify wallet hasn't changed during retry signing
          if (this._address !== addressSnapshot) {
            throw new Error('Wallet changed during deploy retry — aborting', { cause: e });
          }
          const retryPublicKey = retrySig.publicKey || await this.getPublicKey();
          const retrySignedTx: Record<string, unknown> = {
            ...retryData,
            signature: retrySig.signature,
          };
          if (retryPublicKey) retrySignedTx.public_key = retryPublicKey;
          return await submitSigned(retrySignedTx as Record<string, unknown>);
        }
        throw e;
      }
    } finally {
      releaseLock();
    }
  }
}

export const walletService = new WalletService();
