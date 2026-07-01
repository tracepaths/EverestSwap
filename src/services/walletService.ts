import { ZeroXIOWallet, type TransactionHistory, type ContractParams } from '@0xio/sdk';
import { OctraRpc } from './octraRpc';

// [V7-FIX] Fee cache: avoid repeated RPC calls for the same op_type
const _feeCache = new Map<string, { ou: string; ts: number }>();
const FEE_CACHE_TTL = 30_000; // 30s

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
        const publicKey = (result as Record<string, unknown>).publicKey;
        if (typeof sig === 'string') {
          return { signature: sig, publicKey: typeof publicKey === 'string' ? publicKey : undefined };
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
    rpc?: OctraRpc;
  }): Promise<string> {
    if (!params.ou && params.rpc) {
      params.ou = await fetchRecommendedOu(params.rpc, 'call');
    }
    const sdkParams = { contract: params.contract, method: params.method, params: params.params, amount: params.amount, ou: params.ou };
    const result = await this.sdk.callContract(sdkParams);
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
      const now = Date.now() / 1000;
      const tsStr = now === Math.floor(now) ? now.toFixed(1) : now.toString();

      // [FIX] Build canonical JSON manually and sign via octra_signMessage.
      // The SDK's signTransaction validates amount > 0, which rejects deploy txs (amount='0').
      // Manual signing bypasses this validation.
      const json_escape = (s: string) =>
        s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
         .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
      let canonical = `{"from":"${json_escape(addressSnapshot)}"`;
      canonical += `,"to_":"${json_escape(targetAddress)}"`;
      canonical += `,"amount":"0"`;
      canonical += `,"nonce":${nonce}`;
      canonical += `,"ou":"${json_escape(ou)}"`;
      canonical += `,"timestamp":${tsStr}`;
      canonical += `,"op_type":"deploy"`;
      canonical += `,"encrypted_data":"${json_escape(params.bytecode)}"`;
      if (params.message) {
        canonical += `,"message":"${json_escape(params.message)}"`;
      }
      canonical += `}`;

      const sigResult = await this.signMessage(canonical);

      const signedTx: Record<string, unknown> = {
        from: addressSnapshot,
        to_: targetAddress,
        amount: '0',
        nonce,
        ou,
        timestamp: now,
        op_type: 'deploy',
        encrypted_data: params.bytecode,
        signature: sigResult.signature,
      };
      if (sigResult.publicKey) signedTx.public_key = sigResult.publicKey;
      if (params.message) signedTx.message = params.message;

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

          // Re-sign with new nonce using manual canonical JSON approach
          const retryCanonical = `{"from":"${json_escape(addressSnapshot)}","to_":"${json_escape(targetAddress)}","amount":"0","nonce":${retryNonce},"ou":"${json_escape(ou)}","timestamp":${tsStr},"op_type":"deploy","encrypted_data":"${json_escape(params.bytecode)}"${params.message ? `,"message":"${json_escape(params.message)}"` : ''}}`;
          const retrySig = await this.signMessage(retryCanonical);
          const retrySignedTx: Record<string, unknown> = {
            from: addressSnapshot, to_: targetAddress, amount: '0',
            nonce: retryNonce, ou, timestamp: now, op_type: 'deploy',
            encrypted_data: params.bytecode, signature: retrySig.signature,
          };
          if (retrySig.publicKey) retrySignedTx.public_key = retrySig.publicKey;
          if (params.message) retrySignedTx.message = params.message;
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
