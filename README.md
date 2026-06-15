# EverestSwap Frontend

A decentralized exchange (DEX) interface for the Octra Network, built with React, Vite, TypeScript, and Tailwind CSS v4.

## Features

- **Swap** — Trade tokens with constant-product AMM (x*y=k), 0.3% fee
- **Liquidity** — Add/remove liquidity with locked/unlocked positions
- **Pool Creation** — Create custom trading pairs with configurable fee tiers
- **Token Launch** — Deploy new ERC20-compatible tokens on Octra
- **Price Chart** — Real-time price data via indexer
- **Position Management** — Per-user LP positions with optional time locks

## Quick Start

```bash
npm install
npm run dev
```

## Build

```bash
npm run build         # tsc -b && vite build
npx eslint .          # Lint check (0 errors expected)
```

## Project Structure

```
src/
  App.tsx              Route definitions
  main.tsx             Entry point
  pages/               SwapPage, LiquidityPage, DashboardPage, PoolPage, LaunchTokenPage, DocsPage
  components/          Layout, WalletConnector, PoolChart, Toast, TokenSelectModal, TokenTrustBadge
  services/            octraRpc, swapService, walletService, tokenCache
  contexts/            AppContext (wallet, network, RPC)
  config/              devnet.ts, index.ts (RPC URLs)
  hooks/               useIndexer
  types/               index.ts (contract addresses, token definitions)
public/
  contracts/           SwapPool.aml, Token.aml (for on-chain deployment)
```

## Repos

| Repo | Description |
|------|-------------|
| [tracepaths/EverestSwap](https://github.com/tracepaths/EverestSwap) | Frontend (this repo) |
| [tracepaths/EverestSwapDEV](https://github.com/tracepaths/EverestSwapDEV) | Backend — contracts, scripts, deployment |

## Network

- **Devnet**: `https://devnet.octrascan.io/rpc`
- **Mainnet**: `https://octra.network/rpc`

## Wallet

Requires [0xio Wallet](https://0xio.xyz/) browser extension connected to Octra Network.

## License

MIT
