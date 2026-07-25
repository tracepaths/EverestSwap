# EverestSwap — User Guide

Welcome to **EverestSwap**, a decentralized exchange (DEX) deployed on the **Octra Network** — an FHE (Fully Homomorphic Encryption) blockchain with natively encrypted balances and private transactions. This guide covers everything you need to get started.

---

## Quick Start

### 1. Install a Wallet
- Download **0xio Wallet** from [0xio.xyz](https://0xio.xyz/) (an independent, community-built wallet for Octra)
- Alternatively, use the official browser wallet at [wallet.octra.org](https://wallet.octra.org/)
- Create a new wallet or import an existing one
- Make sure you're connected to **Octra Devnet** (or Mainnet for production)

### 2. Get Test Tokens
- Visit the [Octra Devnet Faucet](https://devnet.octrascan.io/faucet) to get free test OCT
- These test tokens have no real value — they're for testing on Devnet

### 3. Connect to EverestSwap
- Open EverestSwap in your browser
- Click **Connect Wallet** (top-right corner)
- Approve the connection in the wallet popup
- You can switch between **Devnet** and **Mainnet** using the network selector in the header

---

## Swapping Tokens

### Swap Tokens

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
- Make sure you have enough OCT for network fees (at least 0.1 OCT)

---

## Providing Liquidity

Adding liquidity earns you a share of the swap fees charged on every trade.

### Add Liquidity to an Existing Pool

1. Go to the **Liquidity** page
2. Click the pool selector at the top to choose a pool
3. Enter the amount of **Token A** you want to deposit
   - Token B is automatically calculated based on the current reserve ratio
4. Choose a **Lock Option**:
   - **Unlocked** — withdraw anytime
   - **30 days** — locked for 30 days
   - **6 months** — locked for 6 months
   - **1 year** — locked for 1 year
   - **Custom** — set your own lock duration in days
   - Locking your LP tokens increases your **rewards multiplier**
5. Review your **Share of Pool** percentage
6. Click **Add Liquidity**
7. Sign **three transactions**: Grant A → Grant B → Add Liquidity

### Add Initial Liquidity (Empty Pool)

- Both Token A and Token B amounts are freely editable
- The ratio you set becomes the initial price

### Rewards

Locked liquidity positions earn rewards distributed per epoch:
- Longer lock periods earn higher rewards
- Rewards are calculated based on your locked LP share relative to total locked LP
- Unlocked positions do not earn rewards

### Remove Liquidity

1. Switch to the **Remove Liquidity** tab
2. See your **LP Balance** and **Pool Share**
3. Select a position to remove (locked positions show remaining lock time)
4. Use the slider or percentage buttons (25%, 50%, 75%, 100%)
5. Review the estimated tokens you'll receive
6. Click **Remove Liquidity**
7. Sign one transaction

---

## Pool Management

### Browse Pools

The **Pool** page shows all existing liquidity pools:
- Pool address, token pair, and fee tier
- Current reserves and total LP supply
- Total locked LP and rewards per epoch
- Each pool's fee tier determines the swap fee:
  - 0.01% — stablecoin pairs (very low fee)
  - 0.05% — moderate fee
  - 0.30% — standard (recommended for most pairs)
  - 1.00% — high fee (exotic pairs)
- Use the search bar to find pools by token symbol or address

### Create a Pool

Create custom trading pairs for any two tokens.

1. Go to the **Pool** page
2. Click **Create Pool**
3. **Select Token A**: Click the token button, search or paste an address
   - Common tokens (OCT, WOCT, OES) appear first
   - Trusted tokens (verified by the factory) show a star badge
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

### Create a Reward Pool

Reward pools let you incentivize liquidity with your own OCS01-compatible tokens.

1. Go to the **Pool** page and click **Create Pool**
2. Select Token A and Token B (same as standard pool)
3. Choose a **Fee Tier** (same as standard pool)
4. **Pool Type**: Toggle to **Reward Pool**
5. **Reward Configuration**:
   - **Reward Token**: Select any OCS01-compatible token (must have `grant`/`pull` interface)
   - **Reward Amount**: Enter the total reward supply (no minimum required)
   - **Duration**: Choose distribution period (1d, 7d, 30d, 90d, 365d)
   - **Creator Lock**: Minimum 7 days (anti-rugpull protection)
6. **Distribution Preview**: Review daily rate and summary
7. Click **Create Pool** — the wizard deploys RewardPool contract, sets config, and grants rewards
8. **Important**: Reward configuration is **immutable** after creation — you cannot change the token, amount, or duration

#### Reward Pool Rules
- Distribution is **linear** — rewards accrue proportionally per epoch
- Formula: `claimable = per_epoch × elapsed × user_lp / total_lp`
- Creator LP tokens are **locked for 7 days minimum** (anti-rugpull)
- Reward config is **one-shot** — cannot be edited after setting
- Emergency withdraw available only after reward end + 7-day cooldown
- All standard AMM features (swaps, routing, liquidity) work identically

---

## Portfolio

The **Portfolio** page (accessible from the sidebar or `/dashboard`) gives you a complete overview of your holdings and activity.

### Your Assets

- **OCT Balance** — your native Octra coin balance (used for gas)
- **Token Balances** — balances of all trusted and imported tokens
- Every asset shows its USD value (when price data is available)
- Trusted tokens display a trust rating badge (★★★★★)
- Click any asset to see details:
  - Token address (with copy button)
  - USD value
  - Trust rating (with vote buttons)
  - View on explorer link

### Trust Voting

Each token has a community trust rating:
- **Upvote/Downvote** — signal whether you trust a token
- **Rating** — calculated from total votes (displayed as stars)
- Trusted tokens (verified by factory admin) start with a high rating
- Connected wallet can vote once per token

### LP Positions

View all your liquidity positions across all pools:
- Pool pair, your share percentage
- LP token balance
- Current value of your position
- Remaining lock time (for locked positions)
- Click a position to see more details

### Transaction History

- Browse your recent transactions
- Each entry shows: action type, status, timestamp
- Click any transaction to view details and a link to the explorer
- Activity is also accessible from the header bar (bell icon)

### Price Chart

- When the indexer service is running, a price chart shows historical price data
- The indexer runs locally on Devnet or as a hosted service
- Swaps and prices still work without the indexer via RPC and DexScreener

---

## Launching a Token

Deploy your own custom token with advanced features. The wizard guides you through 4 steps.

### Step 1: General

- **Token Name** — max 32 characters (e.g., "My Awesome Token")
- **Token Symbol** — max 12 characters, auto-uppercased
- **Decimals** — usually 6, range 0-18
- **Total Supply** — integer (e.g., 1,000,000)
- **Supply Recipient** — who receives the initial supply:
  - **Self** (your wallet) or **Custom address**
- **Token Owner** — who controls the token after deployment:
  - **Self** (your wallet) or **Custom address**
- **Trusted Addresses** — up to 5 addresses exempt from max-wallet limits

### Step 2: Optional Features

Toggle any combination of these features:
- **Mintable** — owner can mint new tokens (increases supply)
- **Burnable** — owner can burn tokens (decreases supply)
- **Pausable** — owner can pause all transfers (emergency stop)
- **Blacklist** — owner can block specific addresses from transferring
- **Max Transaction Amount** — limit how many tokens can be sent in one transaction
- **Max Wallet Amount** — limit how many tokens a single wallet can hold
- **Cooldown** — enforce a delay (in blocks) between transfers from the same wallet (default: 10 blocks)
- **Auto-Burn** — automatically burn a percentage of every transfer (default: 1%)

### Step 3: Taxes

- Enable **Tax** to charge a fee on every transfer
- Set the tax basis points (e.g., 100 = 1%)
- Choose where tax goes: **Self**, **Burn**, or **Custom address**

### Step 4: Review & Deploy

1. Review your configuration in the summary cards (**Raw Supply** and **Preview**)
2. Click **Launch Token**
3. The wizard compiles the contract, computes the address, and deploys
4. On success:
   - Copy the **Token Address**
   - Click **Create Pool** to immediately create a liquidity pool

---

## FAQ

### General

**What network does EverestSwap use?**
EverestSwap runs on the Octra Network. You can use **Devnet** (for testing) or **Mainnet** (for production). Switch networks using the header selector.

**Is there a fee for swapping?**
Each swap charges a fee based on the pool's fee tier (0.01% to 1.00%) that goes to liquidity providers. There's no additional platform fee.

**What tokens can I trade?**
Any pair that has a liquidity pool. Common pairs include WOCT/OES, and you can create pools for any custom tokens.

**What is the difference between Devnet and Mainnet?**
- **Devnet** — test network with free test tokens from the faucet. No real value.
- **Mainnet** — production network with real assets. Requires mainnet configuration to be enabled.

### Transactions

**Why is my transaction stuck?**
Transactions require OCT for network fees (denominated in **ou** — 1 OCT = 1,000,000 ou). Make sure you have at least 0.1 OCT in your wallet.

**How long does each step take?**
- Individual transactions: 2-10 seconds
- Full pool creation (with liquidity): 30-60 seconds

**What does "Grant" mean?**
Granting is like approving — it gives the pool permission to use your tokens. You need to grant before any swap or liquidity operation.

**What is the deadline on transactions?**
All swap and liquidity transactions have a 5-minute deadline. If a transaction isn't confirmed within 5 minutes, it expires and you'll need to try again.

### Tokens

**What are trusted tokens?**
Trusted tokens are verified by the factory admin. They display a star badge (★★★★★) in the token selector and are considered safe.

**Can I trade any custom token?**
Yes, any token address can be imported manually using the **Import token** feature in the token selector. Custom tokens show a trust warning when imported.

**What is the trust rating system?**
Every token has a community-driven trust rating. Connected wallets can upvote or downvote tokens. The rating is displayed as stars and helps identify potentially risky tokens.

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
When you add liquidity, you receive LP tokens representing your share of the pool. These are redeemed when you remove liquidity. You can lock your LP tokens to earn rewards.

**What are locked LP positions?**
Locking prevents early withdrawal but earns you rewards. Choose from 30 days, 6 months, 1 year, or a custom duration. Longer locks earn higher rewards.

**How do rewards work?**
Rewards are distributed per epoch to locked LP holders. Your reward share is proportional to your locked LP relative to the total locked LP in the pool.

### Price & Indexer

**Where does the price data come from?**
Prices come from the on-chain pool reserves (via RPC) and an optional indexer service for historical chart data. On Devnet, the indexer can run locally on `localhost:3123`.

**What if the price chart doesn't show?**
The indexer is best-effort. If it's unavailable, swap and price information still works through direct RPC calls and DexScreener integration.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Wallet not connecting | Make sure 0xio Wallet is installed and on the correct network |
| "Insufficient balance" | Get test OCT from the faucet |
| Transaction keeps failing | Check you have enough OCT for network fees, or increase slippage |
| "Price impact too high" | Check the price impact box to confirm (required above 5%) |
| Pool not appearing | Pools load automatically — try refreshing the page |
| Price chart not showing | The indexer might be down — swaps still work without it |
| Token not found in search | Use **Import token** and paste the contract address |
| Import token shows warning | Custom tokens show a trust warning — verify the address before trading |

---

## Technical Reference

| Item | Value |
|------|-------|
| Network | Octra Network (Devnet / Mainnet) |
| RPC URL | `{{EVERESTSWAP_DEVNET_RPC_URL}}` |
| Indexer URL | `{{EVERESTSWAP_DEVNET_INDEXER_URL}}` |
| Explorer | [{{EVERESTSWAP_DEVNET_EXPLORER_URL}}]({{EVERESTSWAP_DEVNET_EXPLORER_URL}}) |
| SwapFactory | `{{EVERESTSWAP_DEVNET_FACTORY_ADDRESS}}` |
| SwapPool (implementation) | `{{EVERESTSWAP_DEVNET_POOL_ADDRESS}}` |
| Router | `{{EVERESTSWAP_DEVNET_ROUTER_ADDRESS}}` |
| WOCT | `{{EVERESTSWAP_DEVNET_WOCT_ADDRESS}}` |
| OES | `{{EVERESTSWAP_DEVNET_OES_ADDRESS}}` |
| Native Asset | OCT (6 decimals, 1 OCT = 1,000,000 ou) |
| RPC Protocol | JSON-RPC 2.0, `POST /rpc` |
| Wallet | [0xio Wallet](https://0xio.xyz/) (independent) / [wallet.octra.org](https://wallet.octra.org/) (official) |
| Faucet | [Devnet Faucet](https://devnet.octrascan.io/faucet) |

---

## Support

- **Documentation**: This page (always up to date)
- **Issues**: Report bugs at the project repository
- **Octra Docs**: [docs.octra.org](https://docs.octra.org/)
- **OctraScan Explorer**: [octrascan.io](https://octrascan.io/)
- **Octra Labs GitHub**: [github.com/octra-labs](https://github.com/octra-labs)
