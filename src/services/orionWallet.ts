/**
 * Orion Wallet adapter.
 *
 * Orion is a web-app wallet (not a browser extension): it exposes no
 * `window.*` provider, so instead of feature-detecting an injected object we
 * open its `/connect` popup and speak its wire protocol over a private
 * MessageChannel.
 *
 * Orion's SDK is not published to npm and its package is `private`, so this is
 * a minimal client implementing the same protocol rather than a dependency.
 * Keep it in sync with `src/sdk/protocol.ts` in the Orion repo.
 *
 * DESIGN NOTE — signing vs broadcasting:
 * Orion permanently refuses to broadcast (`sendTransaction`/`broadcast` are on
 * a hard denylist). It returns a SIGNED transaction and the dApp submits it.
 * That split is intentional on Orion's side, so `callContract` here signs via
 * the wallet and then submits through our own RPC.
 *
 * The signed payload MUST use `opType: 'call'`, which makes Orion encode the
 * method name into `encrypted_data` and the args as JSON into `message` — the
 * shape the Octra VM parses. The default (`program_call`) packs a nested JSON
 * blob instead and the node reverts.
 */

const PROTOCOL_VERSION = 1;

const METHODS = {
  CONNECT: 'wallet_connect',
  DISCONNECT: 'wallet_disconnect',
  GET_ACCOUNTS: 'wallet_getAccounts',
  GET_ADDRESS: 'wallet_getAddress',
  GET_PUBLIC_KEY: 'wallet_getPublicKey',
  GET_BALANCE: 'wallet_getBalance',
  GET_NETWORK: 'wallet_getNetwork',
  SIGN_MESSAGE: 'wallet_signMessage',
  SIGN_CONTRACT: 'wallet_signContract',
} as const;

const HANDSHAKE_TIMEOUT_MS = 90_000;
/** Signing waits on a human, so it needs a far longer budget than a read. */
const REQUEST_TIMEOUT_MS = 180_000;
const POPUP_FEATURES = 'popup=yes,width=440,height=640,resizable=yes,scrollbars=yes';

/**
 * Convert Orion's internal transaction format to the node's wire format.
 * Orion uses `to` internally; the node requires `to_`. The node also rejects
 * the local-only `hash` field.
 */
function toWireTx(tx: Record<string, unknown>): Record<string, unknown> {
  const wire: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tx)) {
    if (k === 'hash') continue; // local-only, not part of wire protocol
    if (k === 'to') {
      wire.to_ = v;
    } else {
      wire[k] = v;
    }
  }
  return wire;
}

const SESSION_KEY = 'everestswap_orion_session';

export interface OrionAccount {
  address: string;
  publicKey: string;
  name?: string;
  index?: number;
}

export interface OrionConnectResult {
  address: string;
  publicKey: string;
  accounts: OrionAccount[];
  network: string;
  chainId: string;
}

interface Envelope {
  v: number;
  id: string;
  kind: 'req' | 'res' | 'evt';
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: string; message: string };
  event?: string;
  nonce: number;
  ts: number;
}

interface HelloMessage {
  type: 'octra-wallet:hello';
  v: number;
  rid: string;
  challenge: string;
  capabilities: string[];
  walletOrigin: string;
}

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomToken().slice(0, 12)}`;
}

function isEnvelope(x: unknown): x is Envelope {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.v === 'number' &&
    typeof e.id === 'string' &&
    (e.kind === 'req' || e.kind === 'res' || e.kind === 'evt') &&
    typeof e.nonce === 'number' &&
    typeof e.ts === 'number'
  );
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

import { NETWORK } from '../config';

export class OrionWalletClient {
  private port: MessagePort | null = null;
  private popup: Window | null = null;
  private walletOrigin = '';
  private connected = false;
  private nonce = 1;
  private readonly pending = new Map<string, Pending>();
  private address = '';
  private publicKey = '';
  private network = '';
  private connecting: Promise<OrionConnectResult> | null = null;
  private readonly expectedNetwork: string;
  private readonly walletUrl: string;

  constructor(walletUrl: string, expectedNetwork?: string) {
    this.walletUrl = walletUrl;
    this.expectedNetwork = expectedNetwork || NETWORK;
  }

  isConnected(): boolean {
    return this.connected && !!this.port;
  }

  getAddress(): string {
    return this.address;
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  getNetwork(): string {
    return this.network;
  }

  /**
   * Open the wallet popup and complete the handshake.
   *
   * MUST be called synchronously from a user gesture (click), otherwise the
   * browser blocks `window.open`.
   */
  async connect(): Promise<OrionConnectResult> {
    if (this.isConnected() && this.address) {
      return {
        address: this.address,
        publicKey: this.publicKey,
        accounts: [],
        network: this.network,
        chainId: '',
      };
    }
    // Collapse concurrent connect() calls (e.g. double-click) onto one popup.
    if (this.connecting) return this.connecting;

    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<OrionConnectResult> {
    const url = new URL(this.walletUrl);
    this.walletOrigin = url.origin;

    const rid = makeId('rid');
    const dappNonce = randomToken();

    url.searchParams.set('v', String(PROTOCOL_VERSION));
    url.searchParams.set('rid', rid);
    url.searchParams.set('origin', location.origin);
    url.searchParams.set('caps', 'signMessage,signContract,multiAccount,events,sessionRestore');

    const popup = window.open(url.toString(), 'orion-wallet-connect', POPUP_FEATURES);
    if (!popup) {
      throw new Error('Popup blocked — allow popups for this site to connect Orion Wallet');
    }
    this.popup = popup;

    await this.handshake(rid, dappNonce, popup);

    const result = (await this.request(METHODS.CONNECT, {
      origin: location.origin,
    })) as OrionConnectResult;

    if (result.network && result.network.toLowerCase() !== this.expectedNetwork.toLowerCase()) {
      this.close();
      throw new Error(
        `Network mismatch: wallet is on ${result.network} but this app expects ${this.expectedNetwork}. ` +
        `Switch the wallet network and try again.`
      );
    }

    this.address = result.address;
    this.publicKey = result.publicKey;
    this.network = result.network;
    this.connected = true;
    this.persistSession(result);
    return result;
  }

  private handshake(rid: string, dappNonce: string, popup: Window): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let closeWatch: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        window.removeEventListener('message', onHello);
        if (closeWatch) clearInterval(closeWatch);
      };

      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        clearTimeout(timer);
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      };

      const timer = setTimeout(() => fail('Orion Wallet handshake timed out'), HANDSHAKE_TIMEOUT_MS);

      // Only relevant until the port arrives; a MessagePort outlives the window
      // that transferred it, so after that a closing popup is normal.
      closeWatch = setInterval(() => {
        if (this.port) {
          if (closeWatch) clearInterval(closeWatch);
          return;
        }
        if (popup.closed) fail('Orion Wallet window was closed');
      }, 400);

      const onHello = (ev: MessageEvent) => {
        if (ev.origin !== this.walletOrigin) return;
        const data = ev.data as HelloMessage | undefined;
        if (!data || data.type !== 'octra-wallet:hello') return;
        if (data.rid !== rid) return;
        const port = ev.ports?.[0];
        if (!port) return fail('Orion Wallet did not transfer a message port');

        cleanup();
        clearTimeout(timer);

        this.port = port;
        port.onmessage = (e) => this.onPortMessage(e);
        port.start?.();

        // Echo the challenge over the PORT (never over window messaging) to
        // prove we received the hello and open the session.
        port.postMessage({
          __ack: {
            challenge: data.challenge,
            dappNonce,
            v: Math.min(data.v, PROTOCOL_VERSION),
            origin: location.origin,
          },
        });

        settled = true;
        resolve();
      };

      window.addEventListener('message', onHello);
    });
  }

  private onPortMessage(e: MessageEvent): void {
    const data = e.data;
    if (!isEnvelope(data)) return;
    if (data.kind === 'res') {
      const p = this.pending.get(data.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error.message || data.error.code));
      else p.resolve(data.result);
      return;
    }
    if (data.kind === 'evt') {
      if (data.event === 'disconnect' || data.event === 'sessionExpired') {
        this.handleRemoteClose(String(data.event));
      } else if (data.event === 'accountChanged') {
        const p = data.params as { address?: string } | undefined;
        if (p?.address && p.address !== this.address) {
          this.address = p.address;
          this.persistAddress(p.address);
          try {
            window.dispatchEvent(
              new CustomEvent('wallet-account-changed', { detail: { address: p.address } }),
            );
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  private handleRemoteClose(reason: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`Orion Wallet disconnected: ${reason}`));
      this.pending.delete(id);
    }
    this.connected = false;
    this.address = '';
    this.clearSession();
    // Notify the app so the UI drops to a disconnected state (parity with the
    // 0xio extension-lock path, which dispatches an empty-address event).
    try {
      window.dispatchEvent(
        new CustomEvent('wallet-account-changed', { detail: { address: '' } }),
      );
    } catch {
      /* ignore */
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const port = this.port;
    if (!port) return Promise.reject(new Error('Orion Wallet is not connected'));
    const env: Envelope = {
      v: PROTOCOL_VERSION,
      id: makeId('req'),
      kind: 'req',
      method,
      params,
      nonce: this.nonce++,
      ts: Date.now(),
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(env.id);
        reject(new Error(`Orion Wallet request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(env.id, { resolve, reject, timer });
      try {
        port.postMessage(env);
        // Bring the approval window forward if it is still open.
        if (this.popup && !this.popup.closed) this.popup.focus();
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(env.id);
        reject(e);
      }
    });
  }

  async getAccounts(): Promise<OrionAccount[]> {
    return (await this.request(METHODS.GET_ACCOUNTS, {})) as OrionAccount[];
  }

  async getBalance(): Promise<{ balance: string; balanceRaw: string; nonce: number }> {
    return (await this.request(METHODS.GET_BALANCE, {})) as {
      balance: string;
      balanceRaw: string;
      nonce: number;
    };
  }

  /**
   * Sign a plain message.
   *
   * `scheme: 'raw'` signs SHA-256(message) with no domain tag. EverestSwap's
   * canonical-JSON deploy/sign flow verifies untagged signatures, so it must
   * opt in explicitly — Orion's default is domain-separated and would not
   * verify there.
   */
  async signMessage(
    message: string,
    scheme: 'raw' | 'domain' = 'raw',
  ): Promise<{ signature: string; publicKey: string; address: string; scheme: string }> {
    const result = (await this.request(METHODS.SIGN_MESSAGE, { message, scheme })) as {
      signature: string;
      publicKey: string;
      address: string;
      scheme: string;
    };
    this.hidePopup();
    return result;
  }

  /**
   * Ask Orion to sign a contract call. Returns the signed transaction; the
   * caller submits it (Orion never broadcasts).
   */
  async signContract(params: {
    program: string;
    method: string;
    args?: unknown[];
    amount?: string;
    ou?: string;
  }): Promise<{ signedTransaction: Record<string, unknown>; nonce?: number }> {
    const res = (await this.request(METHODS.SIGN_CONTRACT, {
      ...params,
      // Not optional: `call` selects the payload encoding the Octra VM parses.
      opType: 'call',
    })) as { signedTransaction?: Record<string, unknown>; nonce?: number };
    if (!res?.signedTransaction) {
      throw new Error('Orion Wallet returned no signed transaction');
    }
    this.hidePopup();
    return { signedTransaction: toWireTx(res.signedTransaction), nonce: res.nonce };
  }

  /**
   * Check whether the session is still alive on the wallet side.
   *
   * Orion sessions expire after 30 min idle or 8 hours absolute.
   * When expired, the wallet closes the port and emits a disconnect
   * event. This method detects that state so the dApp can prompt
   * the user to reconnect before a swap/liquidity action fails mid-flow.
   */
  isSessionAlive(): boolean {
    return this.connected && !!this.port && !!this.address;
  }

  /**
   * Reopen the wallet popup and re-establish the MessageChannel
   * when the session has dropped. Preserves the stored address
   * hint so the UI can pre-select Orion.
   *
   * Must be called from a user gesture (click) because it uses
   * window.open.
   */
  async refreshSession(): Promise<OrionConnectResult> {
    this.close();
    return this.connect();
  }

  /**
   * Hide the popup window after signing. Keeps the session alive
   * so the user does not need to reconnect for the next transaction.
   */
  hidePopup(): void {
    if (this.popup && !this.popup.closed) {
      try {
        this.popup.close();
      } catch {
        /* ignore — popup may have been closed by the user already */
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.port && this.connected) {
      try {
        await this.request(METHODS.DISCONNECT, {});
      } catch {
        /* best-effort */
      }
    }
    this.close();
  }

  close(): void {
    if (this.port) {
      try {
        this.port.close();
      } catch {
        /* ignore */
      }
      this.port = null;
    }
    if (this.popup && !this.popup.closed) {
      try {
        this.popup.close();
      } catch {
        /* ignore */
      }
    }
    this.popup = null;
    this.connected = false;
    this.address = '';
    this.clearSession();
  }

  // ── Session hint (no secrets; just enough to offer a reconnect) ───────────

  private persistSession(r: OrionConnectResult): void {
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          origin: location.origin,
          address: r.address,
          network: r.network,
          ts: Date.now(),
        }),
      );
    } catch {
      /* storage may be unavailable */
    }
  }

  private persistAddress(address: string): void {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Record<string, unknown>;
      s.address = address;
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }

  private clearSession(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * A prior session hint for this origin, if any.
 *
 * This is only a hint that the user connected Orion before — the port does not
 * survive a page reload, so reconnecting still needs a click (the popup
 * requires a user gesture). It exists so the UI can pre-select Orion rather
 * than silently restore a session.
 */
export function getOrionSessionHint(): { address: string; network: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as {
      origin?: string;
      address?: string;
      network?: string;
    };
    if (s.origin !== location.origin) return null;
    if (!s.address) return null;
    return { address: s.address, network: s.network ?? '' };
  } catch {
    return null;
  }
}

export function clearOrionSessionHint(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
