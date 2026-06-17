// [V7-PASS9] C-9 fix: include tax + auto-burn deduction in output calculation.
// TokenV2 with tax_bps/10000 + auto_burn_bps/10000 fees charges the recipient,
// so user receives `out * (1 - (tax + auto_burn) / 10000)` of the AMM-computed output.
export function calculateOutput(
  amountIn: string,
  reserveIn: string,
  reserveOut: string,
  feeNumerator = 3,
  feeDenominator = 1000,
  outputTaxBps = 0,
  outputAutoBurnBps = 0
): string {
  try {
    const amountInBN = BigInt(amountIn);
    const reserveInBN = BigInt(reserveIn);
    const reserveOutBN = BigInt(reserveOut);
    if (reserveInBN === 0n || reserveOutBN === 0n) return '0';
    const fee = amountInBN * BigInt(feeNumerator) / BigInt(feeDenominator);
    const amountInAfterFee = amountInBN - fee;
    const numerator = amountInAfterFee * reserveOutBN;
    const denominator = reserveInBN + amountInAfterFee;
    if (denominator === 0n) return '0';
    const ammOut = numerator / denominator;
    // [V7-PASS9] Apply output token tax + auto-burn
    // feeBps/10000 of the output is taken by tax_recipient or burned.
    // Use BigInt math to avoid float precision loss.
    const totalOutputFeeBps = BigInt(outputTaxBps) + BigInt(outputAutoBurnBps);
    if (totalOutputFeeBps > 0n && totalOutputFeeBps <= 10000n) {
      const outputFee = ammOut * totalOutputFeeBps / 10000n;
      return (ammOut - outputFee).toString();
    }
    return ammOut.toString();
  } catch {
    throw new Error('Failed to calculate swap output');
  }
}

// [V7-PASS9] C-9 helper: compute total output fee percentage (for UI display)
export function getOutputFeePercent(taxBps: number, autoBurnBps: number): number {
  return (taxBps + autoBurnBps) / 100;
}

export function calculatePriceImpact(amountIn: string, reserveIn: string): number {
  try {
    const amountInBN = BigInt(amountIn);
    const reserveInBN = BigInt(reserveIn);
    if (reserveInBN === 0n) return 0;
    const total = reserveInBN + amountInBN;
    if (total === 0n) return 0;
    return Number(amountInBN * 10000000000n / total) / 100000000;
  } catch {
    return 0;
  }
}

export function formatUnits(raw: string, decimals: number): string {
  if (!raw || raw === '' || raw === '0') return '0';
  try {
    const rawBigInt = BigInt(raw);
    if (rawBigInt === 0n) return '0';
    const divisor = BigInt(10) ** BigInt(decimals);
    const integerPart = rawBigInt / divisor;
    const fractionalPart = rawBigInt % divisor;
    const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
    // [V7-FIX] For sub-1 values (integerPart === 0), keep enough precision
    // to distinguish from zero. For >= 1, strip trailing zeros as before.
    if (integerPart === 0n) {
      // Show full padded form for sub-1 (e.g., 0.000001 stays 0.000001)
      return `0.${fractionalStr}`;
    }
    const trimmed = fractionalStr.replace(/0+$/, '');
    if (trimmed === '') return integerPart.toString();
    return `${integerPart}.${trimmed}`;
  } catch {
    return '0';
  }
}

export function parseUnits(human: string, decimals: number): string {
  if (!human || human === '0') return '0';
  // [SECURITY] FM-5: Reject scientific notation and non-numeric characters
  if (!/^\d+(\.\d+)?$/.test(human)) return '0';
  try {
    // [SECURITY] FM-6: Validate that fractional part doesn't exceed token decimals
    const [intPart, fracPart = ''] = human.split('.');
    if (fracPart.length > decimals) return '0';
    const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals);
    const cleaned = intPart.replace(/^0+/, '');
    const combined = cleaned + paddedFrac;
    if (combined === '' || combined === '0'.repeat(decimals)) return '0';
    return BigInt(combined).toString();
  } catch {
    return '0';
  }
}

export function truncateAddress(address: string, start = 6, end = 4): string {
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

// [SECURITY] F-1: Sanitize numeric input — allow only digits and at most one dot.
// [V7-PASS10] MED-13/14: reject scientific notation (1e18) and negative signs.
// Returns the cleaned string, or empty if input is empty. Returns 'INVALID' if
// input contains e/E/-/+ (so callers can show a clear error).
export function sanitizeNumericInput(input: string): string {
  if (!input) return '';
  // Reject scientific notation and negative signs explicitly
  if (/[eE+-]/.test(input)) return 'INVALID';
  // Strip everything except digits and '.'
  let cleaned = input.replace(/[^0-9.]/g, '');
  // Keep only the first '.'
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  return cleaned;
}
