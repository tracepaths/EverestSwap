// [DEVNET-LOCAL-FIRST] Optional, localhost-first indexer probe.
//
// Strategy:
//   1. Try http://localhost:3123/health with a tight timeout; if alive,
//      return it as the resolved indexer URL (loopback HTTP is allowed).
//   2. Otherwise, fall through to the configured INDEXER_URL — HTTPS-only on
//      the public internet (H-5 still applies).
//   3. If neither is reachable, return null and the hook fails closed (the
//      chart is hidden; swaps/prices keep working via rpc + DexScreener).
//
// The localhost probe is skipped entirely on mainnet builds — it would be
// noisy/fingerprintable for real users and never useful in production.

const LOCAL_INDEXER_CANDIDATE = 'http://localhost:3123';

// Module-scoped cache. React 18 StrictMode double-mounts a hook in dev; the
// visibility-change listener also re-fires; without this we'd hit localhost
// every time. The cache lives for the page session — restarting the indexer
// requires a manual page refresh.
let cachedLocalResult: string | null | undefined; // undefined = not probed yet

// ── Pure predicates ────────────────────────────────────────────────────
//
// `isSecureIndexerUrl` — H-5: any HTTPS URL is fine (Vite + browsers treat
//   https for loopback as secure, so https://localhost:3123 also passes).
// `isLocalIndexerUrl` — only http+loopback. https+loopback is treated as
//   secure, not local; http to a non-loopback host is rejected.
// `isAllowedIndexerUrl` — combined gate used by the hook.

// extractUrlParts is intentionally not exported — kept private so callers
// don't reach past the predicates. URL parsing failures return null silently,
// all callers treat that as "not allowed".
function parseHostname(url: string): { protocol: string; hostname: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return { protocol: u.protocol, hostname: u.hostname };
  } catch {
    return null;
  }
}

export function isSecureIndexerUrl(url: string | null | undefined): boolean {
  const parts = parseHostname(url ?? '');
  return !!parts && parts.protocol === 'https:';
}

export function isLocalIndexerUrl(url: string | null | undefined): boolean {
  const parts = parseHostname(url ?? '');
  if (!parts || parts.protocol !== 'http:') return false;
  return parts.hostname === 'localhost' || parts.hostname === '127.0.0.1';
}

export function isAllowedIndexerUrl(url: string | null | undefined): boolean {
  // https: any host (incl. loopback). http: only loopback.
  return isSecureIndexerUrl(url ?? '') || isLocalIndexerUrl(url ?? '');
}

// ── HTTP probe helper ──────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs: number, extSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (extSignal) {
    if (extSignal.aborted) controller.abort();
    else extSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
    if (extSignal) extSignal.removeEventListener('abort', onAbort);
  }
}

// Probe http://localhost:3123/health. Returns the URL string if the local
// indexer responded OK, else null. Caches the resolution for the page
// session.
export async function probeLocalIndexer(
  timeoutMs = 1500,
  signal?: AbortSignal,
): Promise<string | null> {
  if (cachedLocalResult !== undefined) return cachedLocalResult;
  try {
    const res = await fetchWithTimeout(`${LOCAL_INDEXER_CANDIDATE}/health`, timeoutMs, signal);
    if (!res.ok) {
      cachedLocalResult = null;
      return null;
    }
    // Only commit the URL after we know /health was reached. Don't trust 200
    // alone — drain the body so a misbehaving host doesn't leak resources,
    // and require data.status === 'ok' in case /health returns a different
    // schema than the indexer spec.
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    if (body && typeof body === 'object' && (body as { status?: string }).status === 'ok') {
      cachedLocalResult = LOCAL_INDEXER_CANDIDATE;
      return cachedLocalResult;
    }
  } catch {
    // Connection refused / timeout / DNS failure all fall through.
  }
  cachedLocalResult = null;
  return null;
}

// Test-only: clear the module cache. Production code never invokes this.
// Exported so vitest can call it from beforeEach.
export function _resetIndexerProbeCache(): void {
  cachedLocalResult = undefined;
}

// Exported for the devnet-only check inside the hook.
export function isIndexerMainnetBuild(): boolean {
  return (import.meta.env.EVERESTSWAP_NETWORK || 'devnet') === 'mainnet';
}
