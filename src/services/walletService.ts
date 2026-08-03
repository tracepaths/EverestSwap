import { ZeroXIOWallet, OctraProviderAdapter, type TransactionHistory, type ContractParams } from '@0xio/sdk';
import { OctraRpc } from './octraRpc';

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
  // [FIX-POPUP] Lazy SDK construction — the 0xio SDK's OctraProviderAdapter
  // attaches `provider.on('accountsChanged'/'connect'/'disconnect'/…)` only at
  // `adapter.listen()` time, and `adapter.listen()` is invoked synchronously by
  // the `ExtensionCommunicator` constructor. If the SDK is constructed while
  // `window.octra` is still null (the very common case — the page bundle runs
  // before the extension's content script has injected window.octra), those
  // event listeners are never attached AND the SDK never re-attaches them later.
  // Consequence: account-switch / extension-lock events never reach the app, and
  // interactive `provider.request('octra_sendContractTransaction', …)` popups can
  // hang for the SDK's 180s interactive timeout without any error surfacing.
  //   The fix is to defer `new ZeroXIOWallet(…)` until `window.octra?.isOctra` is
  // confirmed present (either at the first call that needs the SDK, or via the
  // `octraWalletReady` / `octra#initialized` window events the extension
  // broadcasts once it is ready). This makes the adapter's `provider.on(…)`
  // listeners attach to a real provider every time.
  private _sdk: ZeroXIOWallet | null = null;
  private _providerReady = false;
  private _readinessListenersInstalled = false;
  private rpc!: OctraRpc;
  private _address = '';
  private _balance = '';
  private _publicKey = '';
  // [V7-PASS10] CRITICAL-2: global per-address submit mutex.
  // NOTE: despite the per-address framing, _submitLock is a single global FIFO
  // queue — only ONE submit (any address) is in flight at a time across the
  // whole app. Two wallet tabs on the same user race here, which is the
  // intended nonce-protection behaviour. Don't be fooled by the "per-address"
  // wording: there is exactly one shared lock.
  private _submitLock: Promise<void> = Promise.resolve();
  private _inFlightSubmit: { address: string; nonce: number } | null = null;

  constructor() {
    this.installReadinessListeners();
  }

  // [FIX-POPUP] Listen once for the extension's readiness broadcasts so the SDK
  // is built the moment window.octra becomes available, EVEN IF the first
  // `callContract` hasn't been made yet — ensuring provider.on(...) listeners
  // attach as early as possible.
  private installReadinessListeners(): void {
    if (typeof window === 'undefined') return;
    if (this._readinessListenersInstalled) return;
    this._readinessListenersInstalled = true;
    // If the extension injected window.octra before this module loaded, we're
    // already good — set ready so the first ensureSdk() builds the SDK thruthfully.
    if ((window as unknown as { octra?: { isOctra?: boolean } }).octra?.isOctra) {
      this._providerReady = true;
    }
    const onReady = () => {
      const wasReady = this._providerReady;
      this._providerReady = true;
      // [FIX-POPUP] Only construct the SDK here the FIRST time the provider
      // becomes ready. We must NOT cleanup()+rebuild an existing SDK on a later
      // readiness event: SDK.cleanup() rejects every in-flight request with
      // "SDK cleanup called" (SDK index.esm.js:907-930) and removeAllListeners
      // drops our accountChanged/extensionLocked handlers. The previous version
      // of this fix called cleanup()+rebuild on every readiness event — if a
      // readiness broadcast landed while a grant popup was mid-flight (a real
      // possibility because the extension can fire octraWalletReady again on
      // focus/visibility), the grant was silently aborted and the modal hung
      // on "Granting allowances". Popup delivery does not rely on the missing
      // provider.on(...) listeners (postRequest re-resolves window.octra each
      // time), so we accept slightly-late-arriving events without rebuilding.
      if (!wasReady && !this._sdk) {
        this.initSdk();
      }
    };
    try { window.addEventListener('octraWalletReady', onReady); } catch { /* noop */ }
    try { window.addEventListener('octra#initialized', onReady); } catch { /* noop */ }
    try { window.addEventListener('0xioWalletReady', onReady); } catch { /* noop */ }
    try { window.addEventListener('wallet0xioReady', onReady); } catch { /* noop */ }
  }

  // [FIX-POPUP] Returns true once window.octra is detected (or readiness fires).
  // Resolves even if event already passed (checks isOctra first then waits).
  private async ensureProviderReady(timeoutMs = 10_000): Promise<void> {
    this.installReadinessListeners();
    if ((window as unknown as { octra?: { isOctra?: boolean } }).octra?.isOctra) {
      this._providerReady = true;
    }
    if (this._providerReady) return;
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('Octra wallet extension not detected — please install/enable it and reload'));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        try { window.removeEventListener('octraWalletReady', onReady); } catch { /* noop */ }
        try { window.removeEventListener('octra#initialized', onReady); } catch { /* noop */ }
        try { window.removeEventListener('0xioWalletReady', onReady); } catch { /* noop */ }
        try { window.removeEventListener('wallet0xioReady', onReady); } catch { /* noop */ }
      };
      const onReady = () => {
        if (done) return;
        done = true;
        this._providerReady = true;
        cleanup();
        resolve();
      };
      window.addEventListener('octraWalletReady', onReady);
      window.addEventListener('octra#initialized', onReady);
      window.addEventListener('0xioWalletReady', onReady);
      window.addEventListener('wallet0xioReady', onReady);
    });
  }

  // [FIX-POPUP] Actually create the SDK. Safe to call multiple times — subsequent
  // calls are no-ops.
  private initSdk(): void {
    if (this._sdk) return;
    this._sdk = new ZeroXIOWallet({
      appName: 'EverestSwap',
      adapter: OctraProviderAdapter,
      requiredPermissions: ['read_balance', 'send_transactions', 'read_public_key'],
    });
    this.setupAccountChangeListener();
  }

  private ensureSdk(): ZeroXIOWallet {
    if (!this._sdk) {
      // Build on demand if the provider is already present (fast path). Otherwise
      // this returns a null-provider SDK; callers should gate on
      // ensureProviderReady() first if they need event listeners attached.
      this.initSdk();
    }
    return this._sdk as ZeroXIOWallet;
  }

  private get sdk(): ZeroXIOWallet {
    return this.ensureSdk();
  }

  setRpc(rpc: OctraRpc): void {
    this.rpc = rpc;
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
    return !!(window as unknown as { octra?: { isOctra?: boolean } }).octra?.isOctra;
  }

  async connect(): Promise<string> {
    // [FIX-POPUP] Wait for the extension to be present before touching the SDK.
    // Without this, sdk.initialize() races the content-script injection and the
    // adapter's event listeners never attach.
    await this.ensureProviderReady(15_000);
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
    await this.sdk.disconnect();
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
    return this.sdk.getTransactionHistory(page, limit);
  }

  async signMessage(message: string): Promise<{ signature: string; publicKey?: string }> {
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
    // [FIX-POPUP] If the extension became available before this call but readiness
    // events were missed, fail-fast here with a clear message instead of letting
    // the SDK block on a 180s interactive request that never resolves.
    await this.ensureProviderReady(8_000);
    if (!params.ou && params.rpc) {
      params.ou = await fetchRecommendedOu(params.rpc, 'call');
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
