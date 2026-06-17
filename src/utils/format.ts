// [V7-PASS9] M-13: Shared formatters used across components

// Format an OCT balance string (already in OCT, not raw units) for display.
// WalletConnector and AppContext both store balance as formatted OCT (e.g. "1.500000").
export function formatOctBalance(balance: string, forceDecimals?: number): string {
  const num = Number(balance);
  if (!Number.isFinite(num)) return `${balance} OCT`;
  if (forceDecimals !== undefined) return `${num.toFixed(forceDecimals)} OCT`;
  if (num === 0) return '0 OCT';
  if (num < 0.01) return `${num.toFixed(6)} OCT`;
  return `${num.toFixed(2)} OCT`;
}
