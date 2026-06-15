# EverestSwap — User Guide

Welcome to **EverestSwap**, a decentralized exchange (DEX) on the Octra Network. This guide covers everything you need to get started.

---

## Quick Start

### 1. Install 0xio Wallet
- Download **0xio Wallet** from [0xio.xyz](https://0xio.xyz/)
- Create a new wallet or import an existing one
- Make sure you're connected to **Octra Devnet**

### 2. Get Test Tokens
- Visit the [Octra Devnet Faucet](https://devnet.octrascan.io/faucet) to get free test OCT
- These test tokens have no real value — they're for testing on Devnet

### 3. Connect to EverestSwap
- Open EverestSwap in your browser
- Click **Connect Wallet** (top-right corner)
- Approve the connection in the wallet popup

---

## Swapping Tokens

### Swap WOCT ↔ OES

1. Go to the **Swap** page
2. In **You pay**, select the token you're swapping from (default: WOCT)
3. In **You receive**, select the token you're swapping to (default: OES)
4. Enter the amount you want to swap
   - Use the percentage buttons (10%, 25%, 50%, 100%) to quickly use your balance
5. Review the swap details:
   - **Rate** — current exchange rate
   - **Price Impact** — how much your trade affects the price (keep it low!)
   - **Slippage** — maximum price change you'll accept (default 0.5%)
6. Click **Swap**
7. Review the confirmation modal and click **Confirm Swap**
8. Sign **two transactions** in your wallet:
   - **Grant** — approves the pool to use your tokens
   - **Swap** — executes the trade
9. Wait a few seconds for confirmation

### Wrap / Unwrap OCT

- **Wrap OCT → WOCT**: Select OCT as the source token (empty address) and WOCT as the target
- **Unwrap WOCT → OCT**: Select WOCT as the source and OCT as the target
- Wrap/unwrap uses a single transaction (no grant needed)

### Tips for Swapping
- Higher price impact (>5%) means you're moving the market significantly — consider splitting your trade
- Set higher slippage (1%) for volatile tokens
- Make sure you have enough OCT for gas fees (at least 0.1 OCT)

---

## Providing Liquidity

Adding liquidity earns you a share of the 0.3% swap fees charged on every trade.

### Add Liquidity to an Existing Pool

1. Go to the **Liquidity** page
2. Click the pool selector at the top to choose a pool
3. Enter the amount of **Token A** you want to deposit
   - Token B is automatically calculated based on the current reserve ratio
4. Review your **Share of Pool** percentage
5. Click **Add Liquidity**
6. Sign **three transactions**: Grant A → Grant B → Add Liquidity

### Add Initial Liquidity (Empty Pool)

- Both Token A and Token B amounts are freely editable
- The ratio you set becomes the initial price

### Remove Liquidity

1. Switch to the **Remove Liquidity** tab
2. See your **LP Balance** and **Pool Share**
3. Use the slider or percentage buttons (25%, 50%, 75%, 100%)
4. Review the estimated tokens you'll receive
5. Click **Remove Liquidity**
6. Sign one transaction

---

## Creating a Pool

Create custom trading pairs for any two tokens.

1. Go to the **Pool** page
2. Click **Create Pool**
3. **Select Token A**: Click the token button, search or paste an address
   - Common tokens (OCT, WOCT, OES) appear first
   - Trusted tokens (verified by the factory) show a ★★★★★ badge
   - Use **Import token** to add any custom token by address
4. **Select Token B**: Same process (must be different from Token A)
5. **Choose Fee Tier**:
   - 0.01% — stablecoin pairs (very low fee)
   - 0.05% — moderate fee
   - 0.30% — standard (recommended for most pairs)
   - 1.00% — high fee (exotic pairs)
   - Custom — set your own numerator/denominator
6. **(Optional) Initial Liquidity**: Enter amounts to add liquidity immediately
7. Click **Create Pool** (or **Create Pool + Add Liquidity**)
8. The wizard runs 6-9 automatic steps (takes ~30-60 seconds)
9. On success, click **Add / Manage Liquidity** to manage your new pool

---

## Launching a Token

Deploy your own token with a few clicks.

1. Go to the **Launch Token** page
2. Fill in the details:
   - **Token Name** (max 32 chars, e.g., "My Awesome Token")
   - **Token Symbol** (max 12 chars, auto-uppercased)
   - **Decimals** (usually 6, range 0-18)
   - **Total Supply** (integer, e.g., 1,000,000)
3. Review the **Raw Supply** and **Preview** cards
4. Click **Launch Token**
5. The wizard compiles, computes address, and deploys
6. On success:
   - Copy the **Token Address**
   - Click **Create Pool** to immediately create a liquidity pool

---

## Dashboard

The **Dashboard** page shows an overview of:
- Your token balances (OCT, OES)
- LP positions
- Price chart (when the indexer is running)
- Recent transactions

---

## FAQ

### General

**What network does EverestSwap use?**
EverestSwap runs on the Octra Network (Devnet for testing, Mainnet for production).

**Is there a fee for swapping?**
Each swap charges a 0.3% fee that goes to liquidity providers. There's no platform fee.

**What tokens can I trade?**
You can trade any pair that has a liquidity pool. Common pairs include WOCT/OES and any custom tokens you create.

### Transactions

**Why is my transaction stuck?**
Transactions require OCT for gas. Make sure you have at least 0.1 OCT in your wallet.

**How long does each step take?**
- Individual transactions: 2-10 seconds
- Full pool creation (with liquidity): 30-60 seconds

**What does "Grant" mean?**
Granting is like approving — it gives the pool permission to use your tokens. You need to grant before any swap or liquidity operation.

### Tokens

**What are trusted tokens?**
Trusted tokens are verified by the factory admin. They display a ★★★★★ badge in the token selector and are considered safe.

**Can I trade any custom token?**
Yes, any token address can be imported manually using the **Import token** feature in the token selector.

**What's the difference between OCT and WOCT?**
- **OCT** is the native Octra coin (used for gas fees)
- **WOCT** is wrapped OCT (used for trading in the DEX)
- You can wrap/unwrap freely at a 1:1 ratio

### Pools

**Who can create a pool?**
Anyone! Pool creation is permissionless — just connect your wallet and create.

**Can I set custom fees?**
Yes, choose from preset tiers (0.01% to 1.00%) or set a custom numerator/denominator.

**What happens to my LP tokens?**
When you add liquidity, you receive LP tokens representing your share of the pool. These are redeemed when you remove liquidity.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Wallet not connecting | Make sure 0xio Wallet is installed and on Devnet |
| "Insufficient balance" | Get test OCT from the faucet |
| Transaction keeps failing | Check you have enough OCT for gas, or increase slippage |
| Pool not appearing | Pools load automatically — try refreshing the page |
| Price chart not showing | The indexer might be down — swaps still work without it |
| Token not found in search | Use **Import token** and paste the contract address |

---

## Technical Reference

| Item | Value |
|------|-------|
| Network | Octra Devnet |
| RPC URL | `https://devnet.octrascan.io/rpc` |
| SwapFactory | `oct6znV2kFvbNnVpQRWKUq3Hw2mhPEW5Yi5NCJfAVPhQrsE` |
| SwapPool | `octSM8utNG3MLv4Fk2oY1SA2XR99o2i22QUSLbr7Te2tSM4` |
| Router | `oct53wqh6cng95sjLTeLGdSWfNNtfnxy8W3A7H4NK9XmQzY` |
| WOCT | `oct3taQXSQetRSmq21hfLmc1ormx7svm112cUB5uEze3oVe` |
| OES | `oct9LgGSpkrqbpWPQpYervyryzDtbGYph2hHvcBi9ZppNvD` |
| Wallet | [0xio Wallet](https://0xio.xyz/) |
| Faucet | [Devnet Faucet](https://devnet.octrascan.io/faucet) |

---

## Support

- **Documentation**: This page (always up to date)
- **Issues**: Report bugs at the project repository
- **Developer Docs**: See the project's developer documentation for architecture and API details
