import { describe, it, expect } from 'vitest'
import { CONTRACTS, WOCT_TOKEN, OES_TOKEN, INDEXER_URL, RPC_URL } from '../config'

// [AUDIT-FIX M-2] Ensure all addresses are Set A (live devnet) — no stale Set B.
const SET_B_WOCT = 'oct3taQXSQetRSmq21hfLmc1ormx7svm112cUB5uEze3oVe'
const SET_B_ROUTER = 'oct8FKHqsXXE8z11AwKQ7jhEeU7tXefeY4tTRZEnoWK5S3r'

describe('config address consistency (Set A)', () => {
  it('all contract addresses start with oct', () => {
    for (const [, addr] of Object.entries(CONTRACTS)) {
      expect(addr.startsWith('oct')).toBe(true)
    }
  })

  it('WOCT token address is Set A (not stale Set B)', () => {
    expect(WOCT_TOKEN.address).not.toBe(SET_B_WOCT)
    expect(WOCT_TOKEN.address).toBe(CONTRACTS.woct)
  })

  it('router is Set A (not stale Set B)', () => {
    expect(CONTRACTS.router).not.toBe(SET_B_ROUTER)
  })

  it('OES address matches contracts map', () => {
    expect(OES_TOKEN.address).toBe(CONTRACTS.oes)
  })

  it('pool address is non-empty and 47 chars', () => {
    expect(CONTRACTS.pool.length).toBe(47)
  })
})

describe('RPC and indexer endpoints (H-5)', () => {
  it('RPC_URL uses HTTPS', () => {
    expect(RPC_URL.startsWith('https://')).toBe(true)
  })

  it('INDEXER_URL default uses HTTPS (H-5 fix)', () => {
    // [AUDIT-FIX H-5] must never default to http://localhost
    expect(INDEXER_URL.startsWith('https://')).toBe(true)
    expect(INDEXER_URL).not.toContain('localhost')
    expect(INDEXER_URL).not.toContain('127.0.0.1')
  })
})
