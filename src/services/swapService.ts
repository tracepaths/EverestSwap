export function calculateOutput(amountIn: string, reserveIn: string, reserveOut: string, feeNumerator = 3, feeDenominator = 1000): string {
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
    return (numerator / denominator).toString();
  } catch {
    throw new Error('Failed to calculate swap output');
  }
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
    let fractionalStr = fractionalPart.toString().padStart(decimals, '0');
    fractionalStr = fractionalStr.replace(/0+$/, '');
    if (fractionalStr === '') return integerPart.toString();
    return `${integerPart}.${fractionalStr}`;
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
// Reject scientific notation, multiple dots, leading operators, whitespace, and
// Unicode digits. Returns the cleaned string, or empty if input is empty.
export function sanitizeNumericInput(input: string): string {
  if (!input) return '';
  // Strip everything except digits and '.'
  let cleaned = input.replace(/[^0-9.]/g, '');
  // Keep only the first '.'
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
  }
  return cleaned;
}
