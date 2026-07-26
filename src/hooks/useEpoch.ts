import { useState, useCallback, useRef } from 'react';
import { useApp } from '../contexts/AppContext';

let cachedEpoch: number | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL = 60_000;

export function useEpoch() {
  const { rpc } = useApp();
  const [epoch, setEpoch] = useState<number | null>(cachedEpoch);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef<number>(0);

  const fetchEpoch = useCallback(async (force: boolean = false) => {
    const now = Date.now();
    if (!force && cachedEpoch !== null && now < cacheExpiry) {
      return cachedEpoch;
    }
    if (!force && now - lastFetchRef.current < 1000) {
      return cachedEpoch;
    }
    lastFetchRef.current = now;
    setLoading(true);
    try {
      const epochInfo = await rpc.call<{ epoch_id: number }>('epoch_current');
      const epochNum = epochInfo.epoch_id;
      cachedEpoch = epochNum;
      cacheExpiry = now + CACHE_TTL;
      setEpoch(epochNum);
      return epochNum;
    } catch (err) {
      console.error('Failed to fetch epoch:', err);
      return cachedEpoch;
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  return { epoch, loading, fetchEpoch };
}
