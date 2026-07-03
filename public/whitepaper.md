# EverestSwap — Protocol Whitepaper

**Version 1.0 — July 2026**

A decentralized exchange (DEX) on the Octra Network featuring automated market making, permissionless pool creation, token launcher, and locked liquidity rewards.

---

## Abstract

EverestSwap is a decentralized exchange protocol deployed on the Octra Network. It implements a constant-product automated market maker (AMM) model with a modular smart contract architecture. The protocol supports permissionless pool creation, token swapping, liquidity provision with lock-to-earn rewards, and a built-in token launcher. All smart contracts are written in AML (Advanced Mobile Language) and deployed on Octra's UTXO-based chain with Ed25519 cryptographic signing.

---

## Protocol Architecture

### Smart Contract System

The protocol consists of five core contracts deployed on the Octra Network:

- **SwapFactory** — Pool registry and trusted token management
- **SwapPool** — AMM pool implementation (one contract per pair)
- **Router** — Entry point for multi-step swaps
- **WOCT** — Wrapped OCT (native coin wrapper)
- **Token** — Standard OCS01 token interface (ERC-20 equivalent)

### SwapFactory

The factory serves as the on-chain registry for all liquidity pools. Key responsibilities:

- **Pool Registration**: Anyone can register a new pool via `register_pool(address)` — no permission required.
- **Trusted Token List**: Admin maintains a list of verified token addresses (capped at 100), displayed with a trust badge in the UI.
- **Timelock Security**: All setter functions (factory address, WOCT address, fee recipient) use a 24-hour timelock. Once a change is proposed, it can only be executed after 24 hours have passed.

### SwapPool

Each trading pair has its own SwapPool contract. The pool implements:

- **Constant Product AMM**: x \* y = k, where x and y are the reserves of token A and token B.
- **Position-Based LP**: Liquidity positions are tracked individually (not via ERC-20 LP tokens), allowing for lock duration tracking.
- **Locked Liquidity**: LP positions can be locked for 0 (unlocked), 30 days, 6 months, 1 year, or a custom duration. Locked positions earn rewards.
- **Rewards Per Epoch**: Rewards are distributed to locked LP holders each epoch. The reward share is proportional to the user's locked LP relative to total locked LP in the pool.
- **Swap Fee**: Configurable fee tier (0.01% to 1.00%) set at pool creation. The default is 0.30%.

#### Fee Tiers

| Tier | Fee | Recommended Use |
|------|-----|-----------------|
| 0.01% | 0.01% | Stablecoin pairs |
| 0.05% | 0.05% | Moderate liquidity pairs |
| 0.30% | 0.30% | Standard pairs (default) |
| 1.00% | 1.00% | Exotic / volatile pairs |
| Custom | User-defined | Numerator/denominator |

### Router

The Router contract provides a convenient entry point for swaps:

- **swap_exact_tokens_for_tokens(amountIn, minOut, recipient)**: Swaps an exact amount of input tokens for a minimum amount of output tokens.
- **Slippage Protection**: The `minOut` parameter enforces a maximum allowed price movement. The router enforces a hard cap of 10% max slippage.
- **Grant Pattern**: The user must first call `token.grant(router, amount)` to approve the router before swapping.

### WOCT (Wrapped OCT)

WOCT is the wrapped version of the native OCT coin, following the OCS01 token standard:

- **Deposit**: Send OCT to the WOCT contract — mints WOCT at 1:1 ratio.
- **Withdraw**: Burn WOCT — contract sends OCT via `transfer()`.
- **Use Case**: Native OCT cannot be held in AMM pools. WOCT enables OCT to be traded as a standard token.

---

## AMM Mechanism

### Constant Product Formula

The core AMM uses the constant product formula:

```
x * y = k
```

where:
- x = reserve of token A
- y = reserve of token B
- k = constant product

For a swap of `Δx` tokens:

```
Δy = y - (k / (x + Δx))
```

The output `Δy` is reduced by the pool's fee percentage.

### Price Impact

Price impact measures how much a trade moves the market price:

```
priceImpact = 1 - (x / (x + Δx))
```

Swaps with price impact exceeding 5% require explicit user confirmation via a checkbox.

### Slippage Protection

Users set a maximum slippage tolerance (default 0.5%). If the execution price deviates beyond this threshold, the transaction reverts. The Router contract enforces an absolute maximum of 10% slippage.

---

## Tokenomics

### OES Token

OES (Octra Everest Swap) is the protocol's native token:

| Property | Value |
|----------|-------|
| Standard | OCS01 (ERC-20 equivalent) |
| Total Supply | 666,000,000 (666M) |
| Decimals | 6 |
| Contract | `{{EVERESTSWAP_DEVNET_OES_ADDRESS}}` |

OES implements the full OCS01 interface including `transfer`, `grant` (approve), `pull` (transferFrom), `balance_of`, and `allowance`.

### Fee Distribution

Swap fees are distributed entirely to liquidity providers:
- **LP Provider**: 100% of swap fees
- **Protocol**: 0% (no platform fee)

### WOCT / OCT Economics

- **OCT**: Native gas token of the Octra Network
- **WOCT**: Wrapped OCT at 1:1 ratio
- Users need at least 0.1 OCT for gas fees
- OCT can be freely wrapped and unwrapped through the WOCT contract

---

## Security

### Audit & Fixes (V6)

All vulnerabilities from the security audit have been addressed:

| Severity | Issue | Fix |
|----------|-------|-----|
| Critical | Missing `require()` on `call()` returns | Added to all contract calls |
| Critical | Reentrancy via state changes before refund | Moved guard after refund |
| High | No transaction deadline | 5-minute deadline on all operations |
| High | Stale reserves at swap time | Fresh reserve reads at submission |
| High | Unchecked price impact | >5% requires explicit checkbox |
| Medium | No fetch timeout | 15-second timeout on all requests |
| Medium | HTTP instead of HTTPS | HTTPS enforcement on public endpoints |
| Medium | Token cache without TTL | 5-minute cache TTL |
| Medium | Missing parseInt radix | Explicit radix 10 |
| Medium | Double-submit on pool creation | Synchronous submit guard |
| Low | Chart memory leak | Proper cleanup on unmount |
| Low | Keyboard accessibility | Full keyboard navigation |
| Low | No trust warnings | Warning on custom token import |

### Smart Contract Security

- **Reentrancy Guard**: All pool functions use a reentrancy lock to prevent recursive calls.
- **Grant/Pull Pattern**: Token approvals use a two-step grant-pull pattern. The pool pulls tokens from the user after grant approval, preventing address poisoning.
- **Balance Verification**: Fee-on-transfer tokens are handled safely using balance-before/after measurement rather than relying on transfer amounts.
- **Fresh Reserves**: Reserve readings are taken at transaction submission time, not at signing time, preventing front-running via stale data.
- **Initial Price Cap**: Initial liquidity ratios are capped at 100:1 to prevent price manipulation at pool creation.

### Application Security

- **XSS Prevention**: All external URLs in documentation and token metadata are sanitized. `javascript:` and `data:` URIs are rejected.
- **Input Sanitization**: All user inputs are validated and sanitized. Zero-width characters and control characters are stripped from displayed text.
- **Double-Submit Guards**: All transaction submissions use synchronous ref guards to prevent race conditions.
- **CSP**: Content-Security-Policy headers restrict `connect-src` to approved endpoints.
- **Transaction Deadline**: All swap and liquidity transactions expire after 5 minutes.

---

## Trust & Safety System

### Token Trust Rating

Every token on EverestSwap has a community-driven trust rating:

- **Trusted Tokens**: Verified by the factory admin. Displayed with a star badge (★★★★★).
- **Community Voting**: Connected wallets can upvote or downvote any token (one vote per wallet).
- **Rating Calculation**: Composite score from admin verification and community votes.
- **Import Warnings**: Custom tokens (not in the trusted list or saved tokens) show a warning when imported.

### Grant Pattern

The grant-pull mechanism provides an additional security layer:

1. User calls `token.grant(spender, amount)` to approve token spending
2. The spender (pool or router) calls `token.pull(user, spender, amount)` to transfer tokens
3. This prevents address-based attacks common in single-step approval patterns

---

## User Flows

### Token Swap

```
User — token.grant(pool, amountIn) — pool.swap_a_for_b(amountIn, minOut)
```

The swap executes with:
1. Fresh reserve reading from the pool
2. Price impact check (>5% requires confirmation)
3. Slippage check (user-defined, max 10%)
4. 5-minute deadline from submission

### Add Liquidity

```
User — tokenA.grant(pool, amountA) — tokenB.grant(pool, amountB) — pool.add_liquidity(...)
```

Liquidity providers choose a lock duration:
- **Unlocked**: Withdraw anytime, no rewards
- **30 days / 6 months / 1 year**: Locked duration, earns rewards proportional to locked share
- **Custom**: User-defined lock duration in days

### Token Launch

The integrated token launcher compiles, predicts the contract address, and deploys a custom token in a single wizard flow. Features include:

- Mintable, Burnable, Pausable
- Blacklist support
- Max transaction / wallet limits
- Transfer cooldown
- Auto-burn percentage
- Tax on transfers (with configurable recipient)

---

## Technical Specifications

| Parameter | Value |
|-----------|-------|
| Network | Octra Network |
| Consensus | UTXO-based |
| Transaction Signing | Ed25519 |
| Contract Language | AML |
| Token Standard | OCS01 (ERC-20 equivalent) |
| AMM Formula | x \* y = k |
| Max Slippage (Router) | 10% (1000 bps) |
| Price Impact Warning | >5% |
| Transaction Deadline | 5 minutes |
| Timelock (Factory) | 24 hours |
| Max Initial Price Ratio | 100:1 |
| Trusted Token Limit | 100 |
| Cache TTL | 5 minutes |
| Fetch Timeout | 15 seconds |

---

## Roadmap

### Current (V7)

- Core AMM swapping (WOCT/OES and custom pairs)
- Permissionless pool creation with customizable fee tiers
- Liquidity provision with lock-to-earn rewards
- Token launcher with advanced features (mint, burn, pausable, tax, etc.)
- Portfolio dashboard with trust voting and transaction history
- Indexer service for historical price data
- Security audit fixes (all V6 findings resolved)
- Mainnet deployment preparation

### Future

- Multi-hop routing through intermediate pools
- Concentrated liquidity positions
- Governance token and DAO
- Cross-chain bridge integration
- Limit orders
- Advanced analytics dashboard

---

## Contract Addresses

| Contract | Address |
|----------|---------|
| SwapFactory | `{{EVERESTSWAP_DEVNET_FACTORY_ADDRESS}}` |
| SwapPool | `{{EVERESTSWAP_DEVNET_POOL_ADDRESS}}` |
| Router | `{{EVERESTSWAP_DEVNET_ROUTER_ADDRESS}}` |
| WOCT | `{{EVERESTSWAP_DEVNET_WOCT_ADDRESS}}` |
| OES | `{{EVERESTSWAP_DEVNET_OES_ADDRESS}}` |

---

*EverestSwap Protocol — Decentralized Exchange on Octra Network*
