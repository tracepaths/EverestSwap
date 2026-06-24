import type { TokenLaunchConfig } from '../types';

const SELECTED_TOKENS_KEY = 'everestswap_selected_tokens';
const LAUNCH_CONFIG_KEY = 'everestswap_launch_config';
const COOKIE_TTL_DAYS = 7;

interface SavedTokenData {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  timestamp: number;
}

interface SelectedTokensCookie {
  fromToken?: SavedTokenData;
  toToken?: SavedTokenData;
}

function encodeCookie(data: SelectedTokensCookie): string {
  return btoa(JSON.stringify(data));
}

function decodeCookie(str: string): SelectedTokensCookie | null {
  try {
    return JSON.parse(atob(str));
  } catch {
    return null;
  }
}

export const cookieStorage = {
  save: (data: SelectedTokensCookie): void => {
    try {
      const encoded = encodeCookie(data);
      const expires = new Date(Date.now() + COOKIE_TTL_DAYS * 24 * 60 * 60 * 1000).toUTCString();
      document.cookie = `${SELECTED_TOKENS_KEY}=${encoded}; expires=${expires}; path=/; SameSite=Lax`;
    } catch {
      // Silently fail if cookie cannot be set
    }
  },

  load: (): SelectedTokensCookie | null => {
    try {
      const match = document.cookie.match(new RegExp(`(^| )${SELECTED_TOKENS_KEY}=([^;]+)`));
      if (!match) return null;
      const data = decodeCookie(match[2]);
      if (!data) return null;
      const TTL_MS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      if (data.fromToken && now - data.fromToken.timestamp > TTL_MS) {
        data.fromToken = undefined;
      }
      if (data.toToken && now - data.toToken.timestamp > TTL_MS) {
        data.toToken = undefined;
      }
      return data;
    } catch {
      return null;
    }
  },

  clear: (): void => {
    try {
      document.cookie = `${SELECTED_TOKENS_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;
    } catch {
      // Silently fail
    }
  },

  saveLaunchConfig: (config: TokenLaunchConfig, wizardStep: number): void => {
    try {
      const data = { config, wizardStep, timestamp: Date.now() };
      const encoded = btoa(JSON.stringify(data));
      const expires = new Date(Date.now() + COOKIE_TTL_DAYS * 24 * 60 * 60 * 1000).toUTCString();
      document.cookie = `${LAUNCH_CONFIG_KEY}=${encoded}; expires=${expires}; path=/; SameSite=Lax`;
    } catch {
      // Silently fail
    }
  },

  loadLaunchConfig: (): { config: TokenLaunchConfig; wizardStep: 1 | 2 | 3 | 4 } | null => {
    try {
      const match = document.cookie.match(new RegExp(`(^| )${LAUNCH_CONFIG_KEY}=([^;]+)`));
      if (!match) return null;
      const data = JSON.parse(atob(match[2]));
      if (!data || !data.config || Date.now() - data.timestamp > COOKIE_TTL_DAYS * 24 * 60 * 60 * 1000) {
        return null;
      }
      return { config: data.config, wizardStep: data.wizardStep };
    } catch {
      return null;
    }
  },

  clearLaunchConfig: (): void => {
    try {
      document.cookie = `${LAUNCH_CONFIG_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;
    } catch {
      // Silently fail
    }
  },
};