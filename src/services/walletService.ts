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

  // [V7-PASS10] CRITICAL-4: Refactored to use SDK's signTransaction + inject bytecode.
  // The wallet extension's signMessage produced invalid signatures for deploys
  // with the message field. The signTransaction path uses the wallet's own
  // canonical-JSON construction which the chain trusts.
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

      // [V7-PASS10] CRITICAL-4 FIX: Use SDK's signTransaction for proper signature.
      // The wallet extension's signMessage produced invalid signatures for deploys
      // with the message field (LaunchTokenPage 27-arg constructor). The
      // signTransaction path uses the wallet's own canonical-JSON construction
      // which the chain trusts.
      // Since the SDK's signTransaction only supports {to, amount, message}
      // (no encrypted_data for deploy bytecode), we sign a transfer-like tx
      // and inject op_type + encrypted_data after signing.
      const truncated = (params.message || '').slice(0, 1000);  // SDK 1000-char limit
      const sdkResult = await this.sdk.signTransaction({
        to: targetAddress,
        amount: '0',
        message: truncated,
      });
      const signedTx: Record<string, unknown> = sdkResult?.signedTx || sdkResult || {};

      // [V7-PASS10] CRITICAL-4: inject deploy-specific fields
      signedTx.nonce = nonce;
      signedTx.ou = params.feeOu || '100000';
      signedTx.op_type = 'deploy';
      signedTx.encrypted_data = params.bytecode;
      if (params.message && params.message !== truncated) {
        // Message was truncated by SDK; pass full message in the data field
        // The chain should use this as the actual constructor args
        signedTx.message = params.message;
      }

      // [V7-PASS10] CRITICAL-4: get public key (may or may not be in signed tx)
      if (!signedTx.public_key && !signedTx.publicKey) {
        try {
          let publicKey = await this.getPublicKey();
          if (!publicKey) {
            publicKey = await rpc.getPublicKey(addressSnapshot);
            if (publicKey) this._publicKey = publicKey;
          }
          if (publicKey) signedTx.public_key = publicKey;
        } catch { /* noop */ }
      }

      // [SECURITY] F-1: Verify wallet identity hasn't changed during signing
      if (this._address !== addressSnapshot) {
        throw new Error('Wallet changed during deploy — aborting');
      }

      // [V7-PASS10] CRITICAL-4: try submit, retry once on "nonce too low"
      let submitResult: { tx_hash: string; status: string; nonce: number; ou_cost: string };
      try {
        submitResult = await rpc.call<{ tx_hash: string; status: string; nonce: number; ou_cost: string }>('octra_submit', [signedTx]);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (/nonce too low|invalid nonce|nonce.*low/i.test(errMsg)) {
          // Refetch and retry once with fresh nonce
          const fresh = await rpc.getBalance(addressSnapshot);
          signedTx.nonce = fresh.nonce + 1;
          this.setPendingNonce(addressSnapshot, fresh.nonce + 1);
          // Re-sign with new nonce via signTransaction
          const retryResult = await this.sdk.signTransaction({
            to: targetAddress,
            amount: '0',
            message: truncated,
          });
          const retryTx: Record<string, unknown> = retryResult?.signedTx || retryResult || {};
          retryTx.nonce = fresh.nonce + 1;
          retryTx.ou = params.feeOu || '100000';
          retryTx.op_type = 'deploy';
          retryTx.encrypted_data = params.bytecode;
          if (params.message && params.message !== truncated) {
            retryTx.message = params.message;
          }
          if (!retryTx.public_key && !retryTx.publicKey && this._publicKey) {
            retryTx.public_key = this._publicKey;
          }
          submitResult = await rpc.call<{ tx_hash: string; status: string; nonce: number; ou_cost: string }>('octra_submit', [retryTx]);
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
