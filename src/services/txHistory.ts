/**
 * Transaction history service — stores user's recent swaps and liquidity
 * operations in localStorage. The Octra explorer has no public tx history
 * API, so we track locally what the user does from the frontend.
 */

export interface TxRecord {
  hash: string;
  type: 'swap' | 'add_liquidity' | 'remove_liquidity' | 'wrap' | 'unwrap' | 'claim';
  summary: string;
  timestamp: number;
  status: 'success' | 'failed';
}

const STORAGE_KEY = 'everestswap_tx_history';
const MAX_RECORDS = 50;

export function getTxHistory(): TxRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordTx(record: TxRecord): void {
  try {
    const history = getTxHistory();
    // Dedupe by hash
    const filtered = history.filter(h => h.hash !== record.hash);
    filtered.unshift(record);
    // Trim to max
    const trimmed = filtered.slice(0, MAX_RECORDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage might be unavailable (private mode, etc.)
  }
}

export function clearTxHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // noop
  }
}
