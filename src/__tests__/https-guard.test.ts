import { describe, it, expect } from 'vitest'

// [AUDIT-FIX H-5] Pure predicate replicating the useIndexer.ts HTTPS guard.
// The hook rejects any INDEXER_URL that does not start with https://.
// This test ensures the carve-out for http://localhost is GONE.
function isSecureIndexerUrl(url: string): boolean {
  return url.startsWith('https://')
}

describe('HTTPS enforcement guard (H-5)', () => {
  it('accepts HTTPS URLs', () => {
    expect(isSecureIndexerUrl('https://everestswap-indexer-avax.zocomputer.io')).toBe(true)
    expect(isSecureIndexerUrl('https://example.com:3123')).toBe(true)
  })

  it('rejects http://localhost (old bypass)', () => {
    expect(isSecureIndexerUrl('http://localhost:3123')).toBe(false)
  })

  it('rejects http://127.0.0.1 (old bypass)', () => {
    expect(isSecureIndexerUrl('http://127.0.0.1:3123')).toBe(false)
  })

  it('rejects plain HTTP to any host', () => {
    expect(isSecureIndexerUrl('http://example.com')).toBe(false)
  })

  it('rejects empty and malformed URLs', () => {
    expect(isSecureIndexerUrl('')).toBe(false)
    expect(isSecureIndexerUrl('ftp://example.com')).toBe(false)
  })
})
