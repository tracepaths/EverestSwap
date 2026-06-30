import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isLocalIndexerUrl,
  isSecureIndexerUrl,
  isAllowedIndexerUrl,
  probeLocalIndexer,
  _resetIndexerProbeCache,
} from '../services/indexerProbe';

describe('isLocalIndexerUrl (loopback carve-out)', () => {
  it('accepts http+localhost', () => {
    expect(isLocalIndexerUrl('http://localhost:3123')).toBe(true);
    expect(isLocalIndexerUrl('http://localhost:80')).toBe(true);
    expect(isLocalIndexerUrl('http://localhost:3123/health')).toBe(true);
    expect(isLocalIndexerUrl('http://localhost:3123/')).toBe(true);
  });

  it('accepts http+127.0.0.1', () => {
    expect(isLocalIndexerUrl('http://127.0.0.1:3123')).toBe(true);
    expect(isLocalIndexerUrl('http://127.0.0.1:80/health')).toBe(true);
  });

  it('rejects https to loopback (treated as secure, not local)', () => {
    expect(isLocalIndexerUrl('https://localhost:3123')).toBe(false);
    expect(isLocalIndexerUrl('https://127.0.0.1:3123')).toBe(false);
  });

  it('rejects http to non-loopback (H-5 still applies on public internet)', () => {
    expect(isLocalIndexerUrl('http://example.com')).toBe(false);
    expect(isLocalIndexerUrl('http://192.168.1.1:3123')).toBe(false);
    expect(isLocalIndexerUrl('http://10.0.0.1')).toBe(false);
  });

  it('rejects ftp / empty / null / malformed', () => {
    expect(isLocalIndexerUrl(null)).toBe(false);
    expect(isLocalIndexerUrl(undefined)).toBe(false);
    expect(isLocalIndexerUrl('')).toBe(false);
    expect(isLocalIndexerUrl('not a url')).toBe(false);
    expect(isLocalIndexerUrl('ftp://localhost')).toBe(false);
  });
});

describe('isSecureIndexerUrl (H-5)', () => {
  it('accepts https to any host', () => {
    expect(isSecureIndexerUrl('https://example.com')).toBe(true);
    expect(isSecureIndexerUrl('https://everestswap-indexer-avax.zocomputer.io')).toBe(true);
    expect(isSecureIndexerUrl('https://localhost:3123')).toBe(true);
    expect(isSecureIndexerUrl('https://127.0.0.1:3123')).toBe(true);
  });
  it('rejects http to any host (no carve-out)', () => {
    expect(isSecureIndexerUrl('http://localhost:3123')).toBe(false);
    expect(isSecureIndexerUrl('http://127.0.0.1:3123')).toBe(false);
    expect(isSecureIndexerUrl('http://example.com')).toBe(false);
  });
  it('rejects empty / malformed / null', () => {
    expect(isSecureIndexerUrl('')).toBe(false);
    expect(isSecureIndexerUrl(null)).toBe(false);
    expect(isSecureIndexerUrl(undefined)).toBe(false);
    expect(isSecureIndexerUrl('not a url')).toBe(false);
    expect(isSecureIndexerUrl('ftp://example.com')).toBe(false);
  });
});

describe('isAllowedIndexerUrl (combined gate)', () => {
  it('allows https (any host)', () => {
    expect(isAllowedIndexerUrl('https://example.com')).toBe(true);
    expect(isAllowedIndexerUrl('https://localhost:3123')).toBe(true);
    expect(isAllowedIndexerUrl('https://127.0.0.1:3123')).toBe(true);
  });
  it('allows http+loopback (DEVNET-LOCAL-FIRST carve-out)', () => {
    expect(isAllowedIndexerUrl('http://localhost:3123')).toBe(true);
    expect(isAllowedIndexerUrl('http://127.0.0.1:3123')).toBe(true);
  });
  it('rejects http+public (H-5 still applies on the public internet)', () => {
    expect(isAllowedIndexerUrl('http://example.com')).toBe(false);
    expect(isAllowedIndexerUrl('http://192.168.1.1')).toBe(false);
  });
});

describe('probeLocalIndexer', () => {
  beforeEach(() => {
    _resetIndexerProbeCache();
    vi.restoreAllMocks();
  });

  it('returns http://localhost:3123 when /health responds 200 + status:"ok"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    ));
    const url = await probeLocalIndexer(1000);
    expect(url).toBe('http://localhost:3123');
  });

  it('returns null when /health responds non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('teapot', { status: 418 }),
    ));
    const url = await probeLocalIndexer(1000);
    expect(url).toBe(null);
  });

  it('returns null when fetch throws (ECONNREFUSED / timeout / DNS)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const url = await probeLocalIndexer(1000);
    expect(url).toBe(null);
  });

  it('returns null when /health body is not JSON with status:"ok"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('plain text', { status: 200 }),
    ));
    const url = await probeLocalIndexer(1000);
    expect(url).toBe(null);
  });

  it('caches the resolved URL across calls (StrictMode double-mount safe)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const a = await probeLocalIndexer(1000);
    const b = await probeLocalIndexer(1000);
    expect(a).toBe('http://localhost:3123');
    expect(b).toBe('http://localhost:3123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches a null result across calls (no thrash on every tab focus)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    const a = await probeLocalIndexer(1000);
    const b = await probeLocalIndexer(1000);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forwards timeout to AbortController (request aborts within budget)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    ),
    );
    const start = Date.now();
    const url = await probeLocalIndexer(50);
    const elapsed = Date.now() - start;
    expect(url).toBeNull();
    expect(elapsed).toBeLessThan(500); // we asked for 50ms — must abort well before
  });
});
