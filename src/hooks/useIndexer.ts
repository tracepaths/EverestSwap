import { useState, useEffect, useRef } from 'react';
import { INDEXER_URL } from '../types';

// [V7-SECURITY-FIX] Timeout wrapper for indexer fetch
async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
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

export function useIndexer(): IndexerState {
  const [state, setState] = useState<IndexerState>({ available: false, prices: [], loading: true });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // [SECURITY] FM-7: Use a local cancelled flag in addition to mountedRef
    let cancelled = false;
    let healthInterval: ReturnType<typeof setInterval>;

    async function checkHealth() {
      // [V7-SECURITY-FIX] Enforce HTTPS for indexer URL.
      // [AUDIT-FIX H-5] Removed the http://localhost / http://127.0.0.1 carve-out:
      // those resolve to the visitor's own machine and are mixed-content on HTTPS origins.
      // Local dev should set VITE_INDEXER_URL to an HTTPS tunnel or run the indexer over HTTPS.
      if (INDEXER_URL && !INDEXER_URL.startsWith('https://')) {
        if (!cancelled && mountedRef.current) setState({ available: false, prices: [], loading: false });
        return;
      }
      try {
        const res = await fetchWithTimeout(`${INDEXER_URL}/health`);
        if (cancelled || !mountedRef.current) return;
        if (!res.ok) throw new Error('not ok');
        const data = await res.json();
        if (cancelled || !mountedRef.current) return;
        if (data.status === 'ok') {
          const pricesRes = await fetchWithTimeout(`${INDEXER_URL}/api/prices`);
          if (cancelled || !mountedRef.current) return;
          const prices: PricePoint[] = pricesRes.ok ? await pricesRes.json() : [];
          if (cancelled || !mountedRef.current) return;
          setState({ available: true, prices, loading: false });
          if (cancelled || !mountedRef.current) return;
          healthInterval = setInterval(async () => {
            if (cancelled || !mountedRef.current) {
              clearInterval(healthInterval);
              return;
            }
            try {
              const hr = await fetchWithTimeout(`${INDEXER_URL}/health`);
              const hd = await hr.json();
              if (cancelled || !mountedRef.current) return;
              if (hd.status === 'ok') {
                const pr = await fetchWithTimeout(`${INDEXER_URL}/api/prices`);
                const pp: PricePoint[] = pr.ok ? await pr.json() : [];
                if (!cancelled && mountedRef.current) setState(s => ({ ...s, prices: pp }));
              } else {
                if (!cancelled && mountedRef.current) setState(s => ({ ...s, available: false }));
              }
            } catch {
              if (!cancelled && mountedRef.current) setState(s => ({ ...s, available: false }));
            }
          }, 30000);
        } else {
          if (!cancelled && mountedRef.current) setState({ available: false, prices: [], loading: false });
        }
      } catch {
        if (!cancelled && mountedRef.current) setState({ available: false, prices: [], loading: false });
      }
    }

    checkHealth();

    return () => {
      // [SECURITY] FM-7: Set cancelled flag and clear interval on unmount
      cancelled = true;
      mountedRef.current = false;
      if (healthInterval) clearInterval(healthInterval);
    };
  }, []);

  // [SECURITY] FM-12: Refresh when tab becomes visible (catches missed updates
  // when user returns from another tab/wallet)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && mountedRef.current) {
        // Trigger a re-check by dispatching a custom event consumed by the hook above
        // (we simply re-fetch health; safe and cheap)
        fetchWithTimeout(`${INDEXER_URL}/health`, 5000)
          .then(r => r.json())
          .then(hd => {
            if (mountedRef.current && hd?.status === 'ok') {
              setState(s => ({ ...s, available: true }));
            } else if (mountedRef.current) {
              setState(s => ({ ...s, available: false }));
            }
          })
          .catch(() => { if (mountedRef.current) setState(s => ({ ...s, available: false })); });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return state;
}
