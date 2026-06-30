import { describe, it, expect } from 'vitest';
import {
  isSecureIndexerUrl,
  isLocalIndexerUrl,
  isAllowedIndexerUrl,
} from '../services/indexerProbe';

// [AUDIT-FIX H-5] HTTPS-only guard, split into two pure predicates so the
// DEVNET-LOCAL-FIRST carve-out is exercised as a *separate* code path
// rather than silently embedded in `isSecureIndexerUrl`. Both predicates
// are exported from indexerProbe.ts and consumed by useIndexer.ts.

// Mirror the predicates here so this file remains a *pure* unit test
// (no module imports required). If indexerProbe.ts changes semantics,
// these will diverge from the real implementation — that's the whole
// point: anyone editing the probe helper must update this file to match.
function mirrorIsSecure(url: string): boolean {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}
function mirrorIsLocal(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch { return false; }
}
function mirrorIsAllowed(url: string): boolean {
  return mirrorIsSecure(url) || mirrorIsLocal(url);
}

describe('H-5: isSecureIndexerUrl rejects all plain http', () => {
  it('accepts HTTPS URLs (any host, incl. loopback)', () => {
    expect(isSecureIndexerUrl('https://everestswap-indexer-avax.zocomputer.io')).toBe(mirrorIsSecure('https://everestswap-indexer-avax.zocomputer.io'));
    expect(isSecureIndexerUrl('https://example.com:3123')).toBe(true);
    expect(isSecureIndexerUrl('https://localhost:3123')).toBe(true);
  });
  it('rejects http to localhost (carve-out lives in isLocalIndexerUrl)', () => {
    expect(isSecureIndexerUrl('http://localhost:3123')).toBe(false);
    expect(isSecureIndexerUrl('http://localhost:3123')).toBe(mirrorIsSecure('http://localhost:3123'));
  });
  it('rejects http to 127.0.0.1 (carve-out lives in isLocalIndexerUrl)', () => {
    expect(isSecureIndexerUrl('http://127.0.0.1:3123')).toBe(false);
  });
  it('rejects plain http to a public host', () => {
    expect(isSecureIndexerUrl('http://example.com')).toBe(false);
  });
  it('rejects empty and malformed URLs', () => {
    expect(isSecureIndexerUrl('')).toBe(false);
    expect(isSecureIndexerUrl('ftp://example.com')).toBe(false);
  });
});

describe('DEVNET-LOCAL-FIRST: isLocalIndexerUrl carve-out', () => {
  it('accepts http+loopback (localhost)', () => {
    expect(isLocalIndexerUrl('http://localhost:3123')).toBe(true);
    expect(isLocalIndexerUrl('http://localhost:80')).toBe(true);
    expect(isLocalIndexerUrl('http://localhost:3123/health')).toBe(true);
  });
  it('accepts http+127.0.0.1', () => {
    expect(isLocalIndexerUrl('http://127.0.0.1:3123')).toBe(true);
  });
  it('rejects https to loopback (treated as secure)', () => {
    expect(isLocalIndexerUrl('https://localhost:3123')).toBe(false);
    expect(isLocalIndexerUrl('https://127.0.0.1:3123')).toBe(false);
  });
  it('rejects http to non-loopback public host (H-5 still applies)', () => {
    expect(isLocalIndexerUrl('http://example.com')).toBe(false);
    expect(isLocalIndexerUrl('http://192.168.1.1:3123')).toBe(false);
  });
  it('rejects empty / malformed / null', () => {
    expect(isLocalIndexerUrl('')).toBe(false);
    expect(isLocalIndexerUrl('not a url')).toBe(false);
    expect(isLocalIndexerUrl('ftp://localhost')).toBe(false);
  });
});

describe('isAllowedIndexerUrl (the hook actually uses this)', () => {
  it('allows https: any host', () => {
    expect(isAllowedIndexerUrl('https://example.com')).toBe(true);
    expect(isAllowedIndexerUrl('https://everestswap-indexer-avax.zocomputer.io')).toBe(true);
    expect(isAllowedIndexerUrl('https://localhost:3123')).toBe(true);
  });
  it('allows http+loopback (DEVNET-LOCAL-FIRST carve-out)', () => {
    expect(isAllowedIndexerUrl('http://localhost:3123')).toBe(true);
    expect(isAllowedIndexerUrl('http://127.0.0.1:3123')).toBe(true);
  });
  it('rejects http+public (H-5 still applies on the public internet)', () => {
    expect(isAllowedIndexerUrl('http://example.com')).toBe(false);
    expect(isAllowedIndexerUrl('http://192.168.1.1:3123')).toBe(false);
  });
  it('mirrors the in-file predicate exactly (no behavioral drift)', () => {
    const samples = [
      'https://everestswap-indexer-avax.zocomputer.io',
      'https://example.com:3123',
      'https://localhost:3123',
      'http://localhost:3123',
      'http://127.0.0.1:3123',
      'http://example.com',
      'http://192.168.1.1',
      'ftp://example.com',
      '',
      'not a url',
    ];
    for (const s of samples) {
      expect(isAllowedIndexerUrl(s)).toBe(mirrorIsAllowed(s));
    }
  });
});
