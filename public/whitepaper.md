# EverestSwap — Protocol Whitepaper

**Version 1.0 — July 2026**

A decentralized exchange (DEX) deployed on the Octra Network, featuring automated market making, permissionless pool creation, token launcher, and locked liquidity rewards.

---

## Abstract

EverestSwap is a decentralized exchange protocol deployed on the Octra Network. It implements a constant-product automated market maker (AMM) model. The protocol supports permissionless swap pool creation, token swapping, liquidity provision with lock-to-earn rewards, and a built-in token launcher for deploying OCS01-standard tokens.

EverestSwap runs on the **Octra Network** — an FHE (Fully Homomorphic Encryption) blockchain that supports isolated execution environments called **circles** and natively encrypted balances. Smart contracts are written in **AppliedML (AML)**, Octra's high-level contract language, and compile to OCTB bytecode for the **Octra Virtual Machine (OVM)**.

This document describes the protocol's architecture, AMM mechanism, security model, and its relationship to the underlying Octra infrastructure.

---

## The Octra Network

### Overview

Octra is an FHE blockchain network developed by **Octra Labs** (a non-profit association based in Switzerland). It was founded in 2021, with a public testnet launched in June 2025 and mainnet alpha launched in December 2025. The majority of Octra's code is written in OCaml and C++, progressively open-sourced through [official repositories](https://github.com/octra-labs).

Key capabilities:

- **HFHE Encryption**: Hypergraph Fully Homomorphic Encryption enables computation on encrypted data without decryption.
- **Circles**: Isolated execution environments hosting **programs** with dedicated application logic and encrypted data storage.
- **OVM**: Octra Virtual Machine supporting AppliedML (native), Rust, C++, OCaml, and WASM.
- **Dual Balance**: Each wallet maintains a public balance and an encrypted (FHE) balance.
- **Stealth Transactions**: Private transfers with client-side scanning and claiming.

### OCT — Native Asset

OCT is the native utility coin of the Octra Network:

| Property | Value |
|----------|-------|
| Ticker | `$OCT` |
| Max Supply | 1,000,000,000 OCT |
| Genesis Total Supply | 630,000,000 OCT |
| Genesis Circulating Supply | 580,000,000 OCT |
| Decimals | 6 |
| Smallest Unit | `ou` (operational unit) — 1 OCT = 1,000,000 ou |

OCT is used for regular transfers, encrypted balance operations, stealth transactions, program calls with attached value, and payment for network computation.

Genesis distribution: 18.5% early investors, 15% Octra Labs, 10% ecosystem fund, 10% Uniswap CCA, 4.87% Echo/Juicebox contributors, 4.63% faucet, 37% validator rewards.

### OES — Protocol Token

OES (Octra Everest Swap) is a token deployed by the EverestSwap protocol on the Octra Network, following the OCS01 standard:

| Property | Value |
|----------|-------|
| Standard | OCS01 |
| Total Supply | 666,000,000 OES |
| Decimals | 6 |

OES is traded on EverestSwap's AMM pools alongside WOCT and other tokens. It implements the full OCS01 interface: `transfer`, `grant`, `pull`, `balance_of`, and `allowance`.

### OCS01 Token Standard

OCS01 is Octra's native token standard (functionally comparable to ERC-20). It defines:

- `transfer(to, amount)` — transfer tokens
- `grant(spender, amount)` — approve token spending
- `pull(from, spender, amount)` — execute approved transfer
- `balance_of(addr)` — query balance
- `allowance(owner, spender)` — query approved amount

The **grant-pull** pattern is Octra's native approval mechanism, preventing address-based attacks common in single-step approval patterns.

### Wallet and Addresses

- **Address Format**: `oct` prefix + base58-encoded public key hash (47 characters total).
- **Official Wallet**: Browser-based wallet generator at [wallet.octra.org](https://wallet.octra.org).
- **0xio Wallet**: [0xio](https://0xio.xyz/) is an independent, community-built wallet ecosystem for Octra. It is not operated by Octra Labs.
- **OctraScan**: Block explorer at [octrascan.io](https://octrascan.io).

### RPC Interface

Octra exposes a JSON-RPC 2.0 interface at `POST /rpc`. Method groups include: node, accounts, transactions, epochs, fees, programs (contracts), compilation, FHE/encryption, stealth, tokens, and circles. Full specification: [docs.octra.org/developer-docs/rpc-scheme](https://docs.octra.org/developer-docs/rpc-scheme).

### Further Reading

- [Octra Network Litepaper](https://octra.org/litepaper.pdf) (2024)
- [Octra Documentation](https://docs.octra.org/)
- [Octra Labs GitHub](https://github.com/octra-labs)
- [Program Examples](https://github.com/octra-labs/program-examples)

---

## Protocol Architecture

### Contract System

EverestSwap consists of five core contracts deployed on the Octra Network:

- **SwapFactory** — Pool registry and trusted token management
- **SwapPool** — AMM pool implementation (one contract per pair)
- **Router** — Entry point for multi-step swaps
- **WOCT** — Wrapped OCT (native coin wrapper, OCS01 standard)
- **Token** — Standard OCS01 token interface

All contracts are written in **AppliedML (AML)**, Octra's high-level contract language, and compile to OCTB bytecode for the Octra Virtual Machine.

### SwapFactory

The factory serves as the on-chain registry for all swap pools:

- **Pool Registration**: Anyone can register a new pool via `register_pool(address)` — no permission required.
- **Trusted Token List**: Admin maintains a list of verified token addresses (capped at 100), displayed with a trust badge in the UI.
- **Timelock Security**: All setter functions (factory address, WOCT address, fee recipient) use a 24-hour timelock. Once a change is proposed, it can only be executed after 24 hours.

### SwapPool

Each trading pair has its own SwapPool contract. The pool implements:

- **Constant Product AMM**: x \* y = k, where x and y are the reserves of token A and token B.
- **Position-Based LP**: Liquidity positions are tracked individually, allowing for lock duration tracking.
- **Locked Liquidity**: LP positions can be locked for 0 (unlocked), 30 days, 6 months, 1 year, or a custom duration. Locked positions earn rewards.
- **Rewards Per Epoch**: Rewards are distributed to locked LP holders each epoch proportional to their locked LP share.
- **Swap Fee**: Configurable fee tier (0.01% to 1.00%) set at pool creation. Default is 0.30%.

#### Fee Tiers

| Tier | Fee | Recommended Use |
|------|-----|-----------------|
| 0.01% | 0.01% | Stablecoin pairs |
| 0.05% | 0.05% | Moderate liquidity pairs |
| 0.30% | 0.30% | Standard pairs (default) |
| 1.00% | 1.00% | Exotic / volatile pairs |
| Custom | User-defined | Numerator/denominator |

### RewardPool (V9)

RewardPool extends SwapPool with custom reward distribution. It maintains the identical AMM interface (swaps, routing, liquidity all work unchanged) while adding a one-shot, immutable reward configuration.

#### Reward Distribution Model

- **Linear Distribution**: Rewards accrue proportionally per epoch
- **Formula**: `claimable = per_epoch × elapsed × user_lp / total_lp`
- **Per-Epoch Rate**: `total_reward / (reward_end - reward_start)`
- **One-Shot Configuration**: `set_reward_config()` can only be called once — the reward token, amount, start/end epochs are immutable after setting

#### Anti-Rugpull Protection

- **Immutable Reward Config**: Once set, reward token, amount, and duration cannot be changed
- **Creator LP Lock**: Creator must lock LP tokens for minimum 7 days
- **Emergency Withdraw Cooldown**: Available only after `reward_end` + 7-day cooldown (100800 epochs)
- **Permissionless Registration**: Anyone can create reward pools via factory's `register_reward_pool()`

#### Duration Presets

| Preset | Epochs | Days |
|--------|--------|------|
| 1 day | 14,400 | 1 |
| 7 days | 100,800 | 7 |
| 30 days | 432,000 | 30 |
| 90 days | 1,296,000 | 90 |
| 365 days | 5,256,000 | 365 |

#### Reward Token Requirements

- Must be OCS01-compatible (implements `grant`, `pull`, `transfer`)
- No minimum reward supply — creator free to choose any amount
- Creator must hold sufficient reward tokens to fund the pool

#### Claim Mechanics

1. User calls `claim_reward()` on the pool contract
2. Pool calculates `per_epoch × elapsed × user_lp / total_lp`
3. Pool transfers reward tokens to user via `transfer()`
4. Claimable amount updates each epoch as distribution progresses

### Router

The Router contract provides a convenient entry point for swaps:

- **swap_exact_tokens_for_tokens(amountIn, minOut, recipient)**: Swaps an exact amount of input tokens for a minimum amount of output tokens.
- **Slippage Protection**: The `minOut` parameter enforces max 10% slippage. Users set their own tolerance (default 0.5%).
- **Grant Pattern**: User calls `token.grant(router, amount)` to approve the router before swapping.

### WOCT (Wrapped OCT)

WOCT is the wrapped version of the native OCT coin, following the OCS01 token standard:

- **Deposit**: Send OCT to the WOCT contract — mints WOCT at 1:1 ratio.
- **Withdraw**: Burn WOCT — contract sends OCT via `transfer()`.
- **Use Case**: Native OCT cannot be held in AMM pools directly. WOCT enables OCT to be traded as a standard OCS01 token.

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

Users set a maximum slippage tolerance (default 0.5%). If the execution price deviates beyond this threshold, the transaction reverts. The Router contract enforces an absolute maximum of 10% slippage (1000 bps).

---

## Fee Model

Fees on the Octra Network are paid in **ou** (operational units), the smallest denomination of OCT (1 OCT = 1,000,000 ou).

| Operation | Fee Characteristic |
|-----------|-------------------|
| Standard transfer | Low (base fee) |
| Token swap (2 tx: grant + swap) | Moderate |
| Add liquidity (3 tx) | Moderate |
| Pool creation (6-9 steps) | Higher (complex multi-tx) |
| Encrypted operations | Higher (proof generation) |

The recommended fee is provided by the RPC method `octra_recommendedFee(op_type)` and depends on network congestion and operation complexity.

Swap fees (0.01%-1.00%) are separate from network fees and are distributed 100% to liquidity providers.

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

### Contract Security

- **Reentrancy Guard**: All pool functions use a reentrancy lock to prevent recursive calls.
- **Grant/Pull Pattern**: Token approvals use a two-step grant-pull pattern. The pool pulls tokens from the user after grant approval.
- **Balance Verification**: Fee-on-transfer tokens are handled using balance-before/after measurement.
- **Fresh Reserves**: Reserve readings at transaction submission time, not signing time.
- **Initial Price Cap**: Initial liquidity ratios capped at 100:1 to prevent price manipulation.

### Application Security

- **XSS Prevention**: All external URLs sanitized. `javascript:` and `data:` URIs rejected.
- **Input Sanitization**: Zero-width and control characters stripped from displayed text.
- **Double-Submit Guards**: Synchronous ref guards on all transaction submissions.
- **CSP**: Content-Security-Policy restricting `connect-src` to approved endpoints.
- **Transaction Deadline**: 5-minute expiry on all swap and liquidity transactions.

---

## Trust & Safety System

### Token Trust Rating

Every token has a community-driven trust rating:

- **Trusted Tokens**: Verified by the factory admin. Displayed with a star badge (★★★★★).
- **Community Voting**: Connected wallets can upvote or downvote any token (one vote per wallet).
- **Import Warnings**: Custom tokens outside the trusted list show a warning when imported.

### Grant-Pull Pattern

```
User → token.grant(spender, amount) → spender.pull(user, spender, amount)
```

This two-step mechanism prevents address-based attacks common in single-step approval patterns and is the standard Octra OCS01 approval flow.

---

## User Flows

### Token Swap

```
User → token.grant(pool, amountIn) → pool.swap_a_for_b(amountIn, minOut)
```

1. Fresh reserve reading from the pool
2. Price impact check (>5% requires confirmation)
3. Slippage check (user-defined, max 10%)
4. 5-minute deadline from submission

### Wrap / Unwrap OCT

- **Wrap OCT → WOCT**: Send OCT to WOCT contract with `deposit()` call (1 tx, no grant needed).
- **Unwrap WOCT → OCT**: Call `withdraw(amount)` on WOCT contract (1 tx, no grant needed).

### Add Liquidity

```
User → tokenA.grant(pool, amountA) → tokenB.grant(pool, amountB) → pool.add_liquidity(...)
```

Liquidity providers choose a lock duration:
- **Unlocked**: Withdraw anytime, no rewards
- **30 days / 6 months / 1 year**: Locked duration, earns rewards proportional to locked share
- **Custom**: User-defined lock duration in days

### Remove Liquidity

```
User → pool.remove_liquidity(position_id, pct)
```

Liquidity is returned to the user's wallet minus any applicable penalties for early withdrawal of locked positions.

### Token Launch

The integrated token launcher compiles, predicts the contract address, and deploys a custom OCS01-standard token in a 4-step wizard:

1. **General**: Name, symbol, decimals, total supply, token owner, supply recipient, trusted addresses
2. **Features**: Mintable, burnable, pausable, blacklist, max transaction/wallet limits, cooldown, auto-burn
3. **Taxes**: Optional transfer tax with configurable recipient (self, burn, or custom address)
4. **Review & Deploy**: Compile AML source, compute deterministic address, deploy

---

## Technical Specifications

| Parameter | Value |
|-----------|-------|
| Network | Octra Network |
| Virtual Machine | OVM (Octra Virtual Machine) |
| Contract Language | AppliedML (AML) — compiles to OCTB bytecode |
| Token Standard | OCS01 |
| AMM Formula | x \* y = k |
| Address Format | `oct` + base58, 47 chars |
| Transaction Signing | Ed25519 |
| RPC | JSON-RPC 2.0, `POST /rpc` |
| Native Asset | OCT (6 decimals, 1 OCT = 1,000,000 ou) |
| Max Slippage (Router) | 10% (1000 bps) |
| Price Impact Warning | >5% |
| Transaction Deadline | 5 minutes |
| Timelock (Factory) | 24 hours |
| Max Initial Price Ratio | 100:1 |
| Trusted Token Limit | 100 |
| Cache TTL | 5 minutes |
| Fetch Timeout | 15 seconds |

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

## Roadmap

### Current (V7)

- Core AMM swapping (WOCT/OES and custom pairs)
- Permissionless pool creation with customizable fee tiers
- Liquidity provision with lock-to-earn rewards
- Token launcher with advanced features
- Portfolio dashboard with trust voting and transaction history
- Indexer service for historical price data
- Security audit fixes (all V6 findings resolved)
- Mainnet deployment preparation

### Future

- Multi-hop routing through intermediate pools
- Concentrated liquidity positions
- Governance mechanisms
- Cross-chain bridge integration
- Limit orders
- Advanced analytics dashboard
- Leveraged FHE features for private trading

---

## References

- [Octra Network](https://octra.org/)
- [Octra Documentation](https://docs.octra.org/)
- [Octra Litepaper](https://octra.org/litepaper.pdf)
- [Octra Labs GitHub](https://github.com/octra-labs)
- [OctraScan Explorer](https://octrascan.io/)
- [0xio Wallet](https://0xio.xyz/)
- [Octra Wallet Generator](https://wallet.octra.org/)
- [Octra Program Examples](https://github.com/octra-labs/program-examples)
- [Octra RPC Scheme](https://docs.octra.org/developer-docs/rpc-scheme)

---

*EverestSwap Protocol — Decentralized Exchange on the Octra Network*

*Octra is an FHE blockchain network developed by Octra Labs (octra.org). EverestSwap is an independent protocol deployed on Octra.*
