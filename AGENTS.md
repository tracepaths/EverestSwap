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
    contracts/             SwapPool.aml, Token.aml (compiled at deploy time)
    docs.md, favicon.svg, icons.svg
```

## Repos

- **Frontend**: `tracepaths/EverestSwap` (this repo)
- **Backend**: `tracepaths/EverestSwapDEV` (contracts, scripts, deployment)

## Contract Addresses (V12.1 — Devnet, Redeployed 2026-08-04)

Addresses live in `.env` (gitignored) with defaults in `src/config/devnet.ts`.
Keep all three in sync when redeploying: `.env`, `.env.example`, `devnet.ts`.

- OES: `octGURUy7hQhXHVcP9bovbJnpoXqCv2gpWBrk6fqtXqJ2sC` (redeployed 2026-07-25, owner: oct2mhQQYM3MmDwMxbcpvTCMgSVPxh47YUdZGn3aR1r13PK)
- WOCT: `oct4g33tzC2cJncL5RFr9TRiyk8yCNP1h2xaogiWJS5opNv`
- SwapPool (template): `oct9SgrzmX3tyaRMoTHEfEVJLLdhsQ2kSo7ba7iFUq2S1Rh`
- SwapFactory: `octCSV1rFyXj3wWRvLuDZRTNNtnkv24v5FQ34xuAywVKqXu`
- Router: `octEtQJQDFC85tXtGpERHX69rNoo1GJA7EVUaLezANQxC8K` (still bound to the OLD factory — repointing needs propose_factory + 24h timelock)
- RewardPool: `octCfD5XbQwiPUH1CYcQZPJuSuNEbPTtix7LfJAepeGzSr3`
- CAT: `octEw9XG14HA5f15mKLr3PYFbXyqMTLgDninhxrZUtyPvPe` (100B supply, 6 decimals, deployed 2026-07-27)
- CAT_Pool: `octEuicdod5B7kfZa6JQsvEpu3yyTpKh9P6vhNRLotPyMz7` (WOCT/CAT — registered on the OLD factory, NOT carried over to V12)

## Pool Ownership & Removal (V12)

`factory.create()` only PROPOSES pool ownership to the creator
(`pool.transfer_ownership` sets `pending_owner`). The creator stays a non-owner
until they call `pool.accept_ownership()` themselves — until then
`factory.remove_pool()` rejects them with "not pool owner or admin". PoolPage
surfaces an **Accept Ownership** button whenever `pendingOwner === wallet`.

Removal requires BOTH: caller is `pool.get_owner()` AND `get_total_liquidity() == 0`.
Note `total_lp_supply()` never returns to 0 (the burned `minimum_liquidity`
stays), so removability is judged on `total_liquidity` / `MyPool.userLiquidity`.

`owner`, `active`, `fee_numerator`, `fee_denominator` are bare storage fields on
SwapPool, not view fns. Read them via `rpc.getPoolOwner()` /
`getPoolPendingOwner()` / `getPoolActive()` / `getPoolUserLiquidity()`, which try
the V12 getter then fall back to the `storage` map returned by every
`contract_call`. Calling `contractView(addr, 'owner')` directly returns
"method not found" — that bug made "My Pools" permanently empty.

## Key Flows

- Wallet connect via Octra wallet extension (`window.octra`)
- `walletService.callContract()` wraps all contract interactions (returns txHash)
- `rpc.waitForReceipt(hash)` polls until confirmed
- Token approvals: user calls `token.grant(pool, amount)` → pool calls `token.pull(user, pool, amount)`
- Liquidity positions: locked (with unlock_time) or unlocked, managed via `add_liquidity` / `remove_liquidity(position_id, ...)`
- **[V9] Reward Pools**: Standard AMM + custom reward distribution. PoolPage supports creating reward pools with any OCS01 token. LiquidityPage shows reward info and claim button for reward pools.

## Optional Indexer (DEVNET-LOCAL-FIRST)

The price chart on `SwapPage` is fed by an external indexer service. The indexer is **best-effort**: if it can't be reached, the chart is hidden and the rest of the app keeps working via `rpc` + DexScreener. This section exists so a future maintainer doesn't accidentally break the carve-out.

**Probe order** (in `src/hooks/useIndexer.ts` → `resolveIndexerUrl`):

1. **Devnet only** (`import.meta.env.EVERESTSWAP_NETWORK !== 'mainnet'`): probe `http://localhost:3123/health` with a 1.5 s timeout. If it responds `{status:"ok"}`, use `http://localhost:3123` for `/api/prices`.
2. Otherwise (and on mainnet): try the configured `INDEXER_URL`. HTTPS still required on the public internet (H-5 audit fix).
3. If neither resolves → return `null` → `available: false` → chart hidden, swaps/prices keep working via rpc + DexScreener.

**Trade-offs** (intentional, don't "fix" without coordinating):

- **No auto-recovery within a page session**: the local probe result is module-cached for the page session. If the indexer starts/stops mid-session, a manual page refresh is required. Re-probing on every tab focus would re-trigger the strict 1.5 s budget on flaky networks.
- **Mainnet skips localhost entirely**: noisy fingerprinting on real users; pointless in prod.
- **CSP load-bearing**: `index.html`'s `connect-src` includes `http://localhost:3123 http://127.0.0.1:3123`. This carve-out is what allows the devnet probe — do **not** tighten CSP without coordinating with `useIndexer.ts` + the predicate split below.

**Predicate split** (security clarity):

The H-5 HTTPS-only guard is split into 3 predicates so the localhost carve-out lives as a separate, auditable code path:

- `isSecureIndexerUrl(url)` — any `https:` URL (incl. `https+loopback`).
- `isLocalIndexerUrl(url)` — only `http:` + `localhost` / `127.0.0.1` host.
- `isAllowedIndexerUrl(url)` — combined gate (`isSecure` OR `isLocal`).

`http://<public-host>` is still rejected by both `isSecure` and `isLocal` (H-5 unchanged on the public internet).

**Module layout** (single source of truth):

- `src/services/indexerProbe.ts` — predicates + `probeLocalIndexer()` (module-cached) + `isIndexerMainnetBuild()` network gate.
- `src/hooks/useIndexer.ts` — uses the helper, exposes `{available, prices, loading}` to `SwapPage`. Caches the winning URL in a ref so tab-visibility refreshes don't re-probe localhost.
- `src/__tests__/indexerProbe.test.ts` — vitest unit tests (predicate matrix + probe + cache hit + AbortController timing).
- `src/__tests__/https-guard.test.ts` — split predicate tests with mirror checks.

To test the local probe end-to-end: run `node everestswap-dev/indexer/index.mjs` then open the app — the chart should appear within ~1.5 s of page load. Stop the indexer → chart auto-hides within 30 s on the next poll.

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
