const SAVED_TOKENS_KEY = 'everestswap_saved_tokens';
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface SavedToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  timestamp: number;
}

export const tokenStorage = {
  save: (token: SavedToken): void => {
    const tokens = tokenStorage.getAll();
    const existing = tokens.find(t => t.address === token.address);
    if (!existing) {
      tokens.push({ ...token, timestamp: Date.now() });
      localStorage.setItem(SAVED_TOKENS_KEY, JSON.stringify(tokens));
    }
  },

  getAll: (): SavedToken[] => {
    try {
      const data = localStorage.getItem(SAVED_TOKENS_KEY);
      if (!data) return [];
      const tokens: SavedToken[] = JSON.parse(data);
      return tokens.filter(t => Date.now() - t.timestamp < TOKEN_TTL_MS);
    } catch {
      return [];
    }
  },

  remove: (address: string): void => {
    const tokens = tokenStorage.getAll().filter(t => t.address !== address);
    localStorage.setItem(SAVED_TOKENS_KEY, JSON.stringify(tokens));
  },

  clear: (): void => {
    localStorage.removeItem(SAVED_TOKENS_KEY);
  },
};