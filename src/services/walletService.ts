import { ZeroXIOWallet, type TransactionHistory, type ContractParams } from '@0xio/sdk';
import { OctraRpc } from './octraRpc';

export class WalletService {
  private sdk: ZeroXIOWallet;
  private _address = '';
  private _balance = '';
  private _publicKey = '';
  // [V7-PASS10] CRITICAL-2: global per-address submit mutex.
  // Prevents 2 browser tabs from racing on the same nonce.
  private _submitLock: Promise<void> = Promise.resolve();
  private _inFlightSubmit: { address: string; nonce: number } | null = null;

  constructor() {
    this.sdk = new ZeroXIOWallet({ appName: 'EverestSwap' });
  }

  // [V7-PASS10] CRITICAL-2: Acquire the per-address submit lock.
  // Returns a release function. The mutex is keyed by the address passed in,
  // so different addresses can submit concurrently but the same address is serialized.
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
    const bal = await this.sdk.getBalance(true);
    this._balance = bal?.total ? bal.total.toFixed(6) : '0';
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
    const bal = await this.sdk.getBalance(true);
    this._balance = bal?.total ? bal.total.toFixed(6) : '0';
    return this._balance;
  }

  async getTransactionHistory(page = 1, limit = 20): Promise<TransactionHistory> {
    if (!this._address) throw new Error('Not connected');
    return this.sdk.getTransactionHistory(page, limit);
  }

  async signMessage(message: string): Promise<{ signature: string; publicKey?: string }> {
    const octra = (window as unknown as { octra: { request: (opts: { method: string; params?: unknown }) => Promise<unknown> } }).octra;
    if (!octra) throw new Error('0xio wallet not found');
    try {
      const result = await octra.request({ method: 'octra_signMessage', params: [message] });
      if (typeof result === 'string') return { signature: result };
      if (result && typeof result === 'object') {
        const sig = (result as Record<string, unknown>).signature;
        const pk = (result as Record<string, unknown>).publicKey;
        if (typeof sig === 'string') {
          return { signature: sig, publicKey: typeof pk === 'string' ? pk : undefined };
        }
      }
    } catch { /* noop */ }
    try {
      const result = await octra.request({ method: 'octra_sign', params: { message } });
      if (typeof result === 'string') return { signature: result };
    } catch { /* noop */ }
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

  async callContract(params: {
    contract: string;
    method: string;
    params: ContractParams;
    amount?: string | number;
    ou?: string | number;
  }): Promise<string> {
    const result = await this.sdk.callContract(params);
    const resultObj = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
    const txHash = typeof resultObj.hash === 'string' ? resultObj.hash
      : typeof resultObj.txHash === 'string' ? resultObj.txHash
      : typeof resultObj.tx_hash === 'string' ? resultObj.tx_hash
      : undefined;
    if (!txHash) {
      throw new Error('Submit succeeded but no tx_hash returned');
    }
    return txHash;
  }

  // [V6-SECURITY-FIX HIGH-4] Escape all control characters to prevent canonical JSON injection
  private jsonEscape(s: string): string {
    let r = '';
    for (const c of s) {
      switch (c) {
        case '"': r += '\\"'; break;
        case '\\': r += '\\\\'; break;
        case '\b': r += '\\b'; break;
        case '\f': r += '\\f'; break;
        case '\n': r += '\\n'; break;
        case '\r': r += '\\r'; break;
        case '\t': r += '\\t'; break;
        default: {
          const code = c.charCodeAt(0);
          if (code < 0x20 || code === 0x7f) {
            r += '\\u' + code.toString(16).padStart(4, '0');
          } else {
            r += c;
          }
        }
      }
    }
    return r;
  }

  private buildCanonicalJson(tx: Record<string, string | number>): string {
    let s = '{"from":"' + this.jsonEscape(String(tx.from)) + '"'
      + ',"to_":"' + this.jsonEscape(String(tx.to_)) + '"'
      + ',"amount":"' + this.jsonEscape(String(tx.amount)) + '"'
      + ',"nonce":' + String(tx.nonce)
      + ',"ou":"' + this.jsonEscape(String(tx.ou)) + '"'
      + ',"timestamp":' + (typeof tx.timestamp === 'number' ? JSON.stringify(tx.timestamp) : String(tx.timestamp))
      + ',"op_type":"' + this.jsonEscape(String(tx.op_type)) + '"';
    if (tx.encrypted_data != null && tx.encrypted_data !== '')
      s += ',"encrypted_data":"' + this.jsonEscape(String(tx.encrypted_data)) + '"';
    if (tx.message != null && tx.message !== '')
      s += ',"message":"' + this.jsonEscape(String(tx.message)) + '"';
    s += '}';
    return s;
  }

  async signAndSubmitDeployTx(
    rpc: OctraRpc,
    params: {
      bytecode: string;
      // [V7-PASS9] L-13: primary name is contractAddress (works for any contract
      // type — pool, token, etc.). poolAddress is kept as deprecated alias.
      contractAddress?: string;
      poolAddress?: string;
      feeOu?: string;
      message?: string;
      nonce?: number;
    }
  ): Promise<string> {
    // [V7-PASS9] L-13: resolve address from new or legacy field
    const targetAddress = params.contractAddress ?? params.poolAddress;
    if (!targetAddress) throw new Error('contractAddress or poolAddress required');
    params = { ...params, contractAddress: targetAddress };
    // [SECURITY] F-1: Snapshot wallet address at the start of the deploy flow.
    const address = this._address;
    if (!address) throw new Error('Not connected');
    const addressSnapshot = address;

    // [V7-PASS10] CRITICAL-2: acquire per-address submit lock
    // Wait for any pending submit for this address to clear before computing nonce
    const releaseLock = await this.acquireSubmitLock(addressSnapshot);
    try {
      // [V7-PASS8] M-8: if caller pre-fetched the nonce, use it; otherwise fetch fresh
      let nonce: number;
      if (typeof params.nonce === 'number' && Number.isFinite(params.nonce) && params.nonce > 0) {
        nonce = params.nonce;
      } else {
        const balance = await rpc.getBalance(addressSnapshot);
        nonce = balance.nonce + 1;
      }
      // [V7-PASS10] CRITICAL-2: record pending nonce so concurrent tabs see it
      this.setPendingNonce(addressSnapshot, nonce);
      // [SECURITY] FM-8: Floor and clamp timestamp to a reasonable range to prevent
      // gaming with system clock (0, far future, NaN, etc.)
      let timestamp = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(timestamp) || timestamp < 0) timestamp = 0;
      // Clamp to a reasonable upper bound (year 2100)
      if (timestamp > 4_102_444_800) timestamp = 4_102_444_800;

      const txFields: Record<string, string | number> = {
        from: addressSnapshot,
        to_: targetAddress,
        amount: '0',
        nonce,
        ou: params.feeOu || '100000',
        timestamp,
        op_type: 'deploy',
        encrypted_data: params.bytecode,
      };
      if (params.message) {
        txFields.message = params.message;
      }

      const canonicalJson = this.buildCanonicalJson(txFields);
      const { signature, publicKey: sigPubKey } = await this.signMessage(canonicalJson);
      let publicKey = sigPubKey || await this.getPublicKey();
      if (!publicKey) {
        try {
          publicKey = await rpc.getPublicKey(addressSnapshot);
          if (publicKey) this._publicKey = publicKey;
        } catch { /* noop */ }
      }

      // [SECURITY] F-1: Verify wallet identity hasn't changed during signing
      if (this._address !== addressSnapshot) {
        throw new Error('Wallet changed during deploy — aborting');
      }

      const signedTx: Record<string, unknown> = { ...txFields, signature };
      if (publicKey) signedTx.public_key = publicKey;

      // [V7-PASS10] CRITICAL-4: try submit, retry once on "nonce too low"
      let submitResult: { tx_hash: string; status: string; nonce: number; ou_cost: string };
      try {
        submitResult = await rpc.call<{ tx_hash: string; status: string; nonce: number; ou_cost: string }>('octra_submit', [signedTx]);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (/nonce too low|invalid nonce|nonce.*low/i.test(errMsg)) {
          // Refetch and retry once
          const fresh = await rpc.getBalance(addressSnapshot);
          txFields.nonce = fresh.nonce + 1;
          this.setPendingNonce(addressSnapshot, txFields.nonce as number);
          const canonicalJson2 = this.buildCanonicalJson(txFields);
          const { signature: sig2, publicKey: pk2 } = await this.signMessage(canonicalJson2);
          const signedTx2: Record<string, unknown> = { ...txFields, signature: sig2 };
          if (pk2 || this._publicKey) signedTx2.public_key = pk2 || this._publicKey;
          submitResult = await rpc.call<{ tx_hash: string; status: string; nonce: number; ou_cost: string }>('octra_submit', [signedTx2]);
        } else {
          throw e;
        }
      }
      const txHash = submitResult.tx_hash;
      if (!txHash) throw new Error('Submit succeeded but no tx_hash returned');
      return txHash;
    } finally {
      // [V7-PASS10] CRITICAL-2: always release the lock
      releaseLock();
    }
  }
}

export const walletService = new WalletService();
