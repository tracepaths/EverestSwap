import { useState, useEffect, useRef } from 'react';
import { INDEXER_URL } from '../types';

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
    let healthInterval: ReturnType<typeof setInterval>;

    async function checkHealth() {
      try {
        const res = await fetch(`${INDEXER_URL}/health`);
        if (!res.ok) throw new Error('not ok');
        const data = await res.json();
        if (!mountedRef.current) return;
        if (data.status === 'ok') {
          const pricesRes = await fetch(`${INDEXER_URL}/api/prices`);
          const prices: PricePoint[] = pricesRes.ok ? await pricesRes.json() : [];
          if (mountedRef.current) {
            setState({ available: true, prices, loading: false });
          }
          if (mountedRef.current) {
            healthInterval = setInterval(async () => {
              try {
                const hr = await fetch(`${INDEXER_URL}/health`);
                const hd = await hr.json();
                if (!mountedRef.current) return;
                if (hd.status === 'ok') {
                  const pr = await fetch(`${INDEXER_URL}/api/prices`);
                  const pp: PricePoint[] = pr.ok ? await pr.json() : [];
                  if (mountedRef.current) setState(s => ({ ...s, prices: pp }));
                } else {
                  if (mountedRef.current) setState(s => ({ ...s, available: false }));
                }
              } catch {
                if (mountedRef.current) setState(s => ({ ...s, available: false }));
              }
            }, 30000);
          }
        } else {
          if (mountedRef.current) setState({ available: false, prices: [], loading: false });
        }
      } catch {
        if (mountedRef.current) setState({ available: false, prices: [], loading: false });
      }
    }

    checkHealth();

    return () => {
      mountedRef.current = false;
      if (healthInterval) clearInterval(healthInterval);
    };
  }, []);

  return state;
}
