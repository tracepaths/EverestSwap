import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchOctUsdPrice, getUsdPriceForToken, calculateUsdValue } from '../services/priceService';
import { PRICE_CACHE_TTL_MS } from '../config/prices';
import type { OctraRpc } from '../services/octraRpc';

interface PriceState {
  octPrice: number;
  loading: boolean;
}

export function usePriceService(rpc: OctraRpc) {
  const [state, setState] = useState<PriceState>({ octPrice: 0, loading: true });
  const mountedRef = useRef(true);

  const refreshOctPrice = useCallback(async () => {
    try {
      const price = await fetchOctUsdPrice();
      if (mountedRef.current) setState({ octPrice: price, loading: false });
    } catch {
      if (mountedRef.current) setState(s => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refreshOctPrice();
    const interval = setInterval(refreshOctPrice, PRICE_CACHE_TTL_MS);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, [refreshOctPrice]);

  const getTokenUsd = useCallback(
    async (tokenAddress: string): Promise<number> => {
      return getUsdPriceForToken(tokenAddress, rpc);
    },
    [rpc],
  );

  return {
    octPrice: state.octPrice,
    loading: state.loading,
    getTokenUsd,
    calculateUsdValue,
  };
}
