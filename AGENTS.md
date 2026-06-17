# EverestSwap Frontend — Agent Guide

## Project Structure

```
everestswap/
  src/
    App.tsx                Route definitions
    main.tsx               Entry point
    index.css              Global styles (Tailwind v4)
    pages/                 SwapPage, LiquidityPage, DashboardPage, PoolPage, LaunchTokenPage, DocsPage
    components/            Layout, WalletConnector, PoolChart, Toast, TokenSelectModal, TokenTrustBadge, ErrorBoundary, SnowEffect
    services/              octraRpc, swapService, walletService, tokenCache
    contexts/              AppContext (wallet, network, RPC)
    config/                devnet.ts, index.ts (RPC URLs)
    hooks/                 useIndexer
    types/                 index.ts (contract addresses, token definitions)
  public/
    contracts/             SwapPool.aml, TokenV2.aml (compiled at deploy time)
    docs.md, favicon.svg, icons.svg
```

## Repos

- **Frontend**: `tracepaths/EverestSwap` (this repo)
- **Backend**: `tracepaths/EverestSwapDEV` (contracts, scripts, deployment)

## Contract Addresses (V6 — Devnet)

- OES: `oct9LgGSpkrqbpWPQpYervyryzDtbGYph2hHvcBi9ZppNvD`
- WOCT: `oct3taQXSQetRSmq21hfLmc1ormx7svm112cUB5uEze3oVe`
- SwapPool: `octSM8utNG3MLv4Fk2oY1SA2XR99o2i22QUSLbr7Te2tSM4`
- SwapFactory: `oct6znV2kFvbNnVpQRWKUq3Hw2mhPEW5Yi5NCJfAVPhQrsE`
- Router: `oct53wqh6cng95sjLTeLGdSWfNNtfnxy8W3A7H4NK9XmQzY`

## Key Flows

- Wallet connect via Octra wallet extension (`window.octra`)
- `walletService.callContract()` wraps all contract interactions (returns txHash)
- `rpc.waitForReceipt(hash)` polls until confirmed
- Token approvals: user calls `token.grant(pool, amount)` → pool calls `token.pull(user, pool, amount)`
- Liquidity positions: locked (with unlock_time) or unlocked, managed via `add_liquidity` / `remove_liquidity(position_id, ...)`

## Build Commands

```bash
npm install           Install dependencies
npm run build         tsc -b && vite build
npx eslint .          Lint check (0 errors expected)
```

## Security Fixes (V6)

All critical/high/medium vulnerabilities from security audit have been addressed:
- CRITICAL: `require()` on all `call()` returns in SwapPool.aml
- CRITICAL: Reentrancy guard moved after refund transfers
- HIGH: 5-minute deadline on all swap/liquidity transactions
- HIGH: Fresh reserves at swap submission time
- HIGH: Price impact gate (>5% requires checkbox)
- MEDIUM: Fetch timeout, HTTPS enforcement, token cache TTL, parseInt radix 10
- MEDIUM: Double-submit guard on pool creation
- LOW: Chart memory leak fixed, keyboard accessibility, trust warnings on token import
