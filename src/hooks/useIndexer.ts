import { useState, useEffect, useRef } from 'react';
import { INDEXER_URL } from '../types';
import {
  probeLocalIndexer,
  isAllowedIndexerUrl,
  isIndexerMainnetBuild,
} from '../services/indexerProbe';

// [V7-SECURITY-FIX] Timeout wrapper for indexer fetch (10 s default for live
// reads — health and prices are short reads).
async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

interface PricePoint {
  time: number;
  price: number;
}

interface IndexerState {
  available: boolean;
  prices: PricePoint[];
  loading: boolean;
}

// [DEVNET-LOCAL-FIRST] Two-tier indexer URL resolution:
//   1. Devnet only: probe http://localhost:3123/health with a tight 1.5 s
//      timeout. If alive, use it (loopback HTTP is allowed by the carve-out
//      in isAllowedIndexerUrl + by CSP).
//   2. Otherwise: fall through to the configured INDEXER_URL. The H-5 guard
//      still applies via isAllowedIndexerUrl — https anywhere, http only on
//      loopback, http on public hosts is rejected.
//   3. If neither resolves, return null and the hook fails closed. The chart
//      stays hidden; the rest of the app keeps working via rpc + DexScreener.
async function resolveIndexerUrl(): Promise<string | null> {
  if (!isIndexerMainnetBuild()) {
    const local = await probeLocalIndexer(1500);
    if (local) return local;
  }
  if (INDEXER_URL && isAllowedIndexerUrl(INDEXER_URL)) {
    return INDEXER_URL;
  }
  return null;
}

export function useIndexer(): IndexerState {
  const [state, setState] = useState<IndexerState>({ available: false, prices: [], loading: true });
  const mountedRef = useRef(true);
  // Cache the winning URL across visibility events — never re-probe on tab
  // focus. Restarting the local indexer requires a manual page refresh.
  const resolvedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    let healthInterval: ReturnType<typeof setInterval> | undefined;

    async function poll(url: string): Promise<void> {
      if (cancelled || !mountedRef.current) return;
      try {
        const hr = await fetchWithTimeout(`${url}/health`, 5000);
        if (cancelled || !mountedRef.current) return;
        if (!hr.ok) throw new Error('not ok');
        const hd = await hr.json();
        if (cancelled || !mountedRef.current) return;
        if (hd?.status === 'ok') {
          const pricesRes = await fetchWithTimeout(`${url}/api/prices`, 8000);
          if (cancelled || !mountedRef.current) return;
          const pp: PricePoint[] = pricesRes.ok ? await pricesRes.json() : [];
          if (!cancelled && mountedRef.current) setState({ available: true, prices: pp, loading: false });
        } else {
          if (!cancelled && mountedRef.current) setState({ available: false, prices: [], loading: false });
        }
      } catch {
        if (!cancelled && mountedRef.current) setState(s => ({ ...s, available: false }));
      }
    }

    (async () => {
      const resolvedUrl = await resolveIndexerUrl();
      if (cancelled || !mountedRef.current) return;
      resolvedUrlRef.current = resolvedUrl;
      if (!resolvedUrl) {
        // Neither local nor public indexer reachable — fail closed (chart
        // hidden, app keeps working via rpc + DexScreener).
        setState({ available: false, prices: [], loading: false });
        return;
      }
      await poll(resolvedUrl);
      if (cancelled || !mountedRef.current) return;
      healthInterval = setInterval(() => { void poll(resolvedUrl); }, 30000);
    })();

    return () => {
      // [SECURITY] FM-7: Set cancelled flag and clear interval on unmount
      cancelled = true;
      mountedRef.current = false;
      if (healthInterval) clearInterval(healthInterval);
    };
  }, []);

  // [SECURITY] FM-12: Refresh when tab becomes visible. Only re-polls the
  // already-resolved URL — does NOT re-probe localhost (cache holds the
  // result for the page session).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !mountedRef.current) return;
      const url = resolvedUrlRef.current;
      if (!url) return;
      fetchWithTimeout(`${url}/health`, 5000)
        .then(r => r.json())
        .then(hd => {
          if (mountedRef.current && hd?.status === 'ok') {
            setState(s => ({ ...s, available: true }));
          } else if (mountedRef.current) {
            setState(s => ({ ...s, available: false }));
          }
        })
        .catch(() => { if (mountedRef.current) setState(s => ({ ...s, available: false })); });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return state;
}
