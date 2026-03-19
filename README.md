# AOX AgentTreasury

**stETH Agent Treasury primitive for AI agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built for The Synthesis](https://img.shields.io/badge/Built%20for-The%20Synthesis-blue)](https://synthesis.devfolio.co)

---

## Overview

AgentTreasury is a **principal-locked yield treasury** for AI agents. It allows humans to deposit wstETH principal, let yield accrue, and gives AI agents permission to spend **only the yield** — never touching the principal.

Built for the **stETH Agent Treasury** prize track at The Synthesis Ethereum Agent Hackathon 2026.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentTreasury                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              PRINCIPAL (Locked)                      │   │
│  │         Owner: 0x0559...94D0 (AOX CEO)              │   │
│  │                                                     │   │
│  │  • Human deposits wstETH                           │   │
│  │  • Structurally locked — agent CANNOT touch        │   │
│  │  • Owner can withdraw anytime                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                   │
│                          ▼ (yield accrues)                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              YIELD (Agent Accessible)                │   │
│  │        Agent: 0x7e7f...3373 (Banker)                 │   │
│  │                                                     │   │
│  │  • Agent can withdraw yield via x402              │   │
│  │  • Spending cap per transaction (default: ~10 USDC) │   │
│  │  • All withdrawals logged on-chain                │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Principal Lock** | wstETH principal is structurally locked; agent can never spend it |
| **Yield-Only Spending** | Agent (Banker) can withdraw only accrued yield |
| **Spending Caps** | Configurable per-transaction limits (default ~10 USDC equivalent) |
| **Full Transparency** | All deposits, withdrawals, and yield events logged on-chain |
| **Emergency Rescue** | Owner can rescue other tokens, but wstETH is protected |

---

## Contract Architecture

### State Variables

```solidity
IERC20 public immutable wstETH;           // wstETH token (Base: 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452)
address public agentWallet;               // Banker Agent: 0x7e7f825248Ae530610F34a5deB9Bc423f6d63373
uint256 public principal;                 // Tracked principal deposits
uint256 public spendingCap;               // Per-transaction yield spending limit
```

### Core Functions

#### For Owners (AOX CEO)

| Function | Description |
|----------|-------------|
| `deposit(uint256 amount)` | Deposit wstETH as principal |
| `withdrawPrincipal(uint256 amount)` | Withdraw principal (anytime) |
| `withdrawAllPrincipal()` | Withdraw all principal |
| `setSpendingCap(uint256 newCap)` | Update per-transaction yield limit |
| `setAgentWallet(address newAgent)` | Change authorized agent wallet |

#### For Agents (Banker)

| Function | Description |
|----------|-------------|
| `withdrawYield(uint256 amount)` | Withdraw accrued yield (capped per tx) |

#### View Functions

| Function | Description |
|----------|-------------|
| `getTotalBalance()` | Total wstETH in treasury |
| `getAvailableYield()` | Yield available for agent withdrawal |
| `getPrincipal()` | Locked principal amount |

---

## Deployed Contract

| Network | Address | Status |
|---------|---------|--------|
| Base Mainnet | TBD | Not deployed yet |
| Base Sepolia | TBD | Not deployed yet |

---

## Usage

### 1. Install Dependencies

```bash
npm install
```

### 2. Compile

```bash
npm run compile
```

### 3. Test

```bash
npm test
```

### 4. Deploy

```bash
# Base Sepolia (testnet)
export PRIVATE_KEY=your_private_key
export BASE_SEPOLIA_RPC=https://sepolia.base.org
npm run deploy:base-sepolia

# Base Mainnet
export PRIVATE_KEY=your_private_key
export BASE_RPC=https://mainnet.base.org
export BASESCAN_API_KEY=your_api_key
npm run deploy:base
```

### 5. Verify

```bash
npm run verify:base -- CONTRACT_ADDRESS WSTETH_ADDRESS AGENT_ADDRESS OWNER_ADDRESS
```

---

## Banker Agent Integration

The Banker Agent (0x7e7f...3373) can:

1. **Check available yield**: `AgentTreasury.getAvailableYield()`
2. **Withdraw yield**: `AgentTreasury.withdrawYield(amount)`
3. **Respect spending caps**: Each withdrawal must be ≤ `spendingCap`

### Example Agent Flow

```javascript
// Banker Agent checks available yield
const yield = await treasury.getAvailableYield();

// If yield > 0, withdraw up to spending cap
const cap = await treasury.spendingCap();
const withdrawAmount = yield < cap ? yield : cap;

if (withdrawAmount > 0) {
  await treasury.connect(bankerWallet).withdrawYield(withdrawAmount);
  console.log(`Withdrew ${withdrawAmount} wstETH yield`);
}
```

---

## Yield Calculation

Yield is calculated as the difference between total balance and tracked principal:

```solidity
function getAvailableYield() public view returns (uint256) {
    uint256 totalBalance = wstETH.balanceOf(address(this));
    if (totalBalance <= principal) {
        return 0;
    }
    return totalBalance - principal;
}
```

Since wstETH is a rebasing token, yield accrues automatically — no explicit harvesting required.

---

## Security Model

| Risk | Mitigation |
|------|------------|
| **Agent steals principal** | Structurally impossible — agent can only call `withdrawYield()` |
| **Owner rug pulls** | Owner can withdraw principal, but that's by design (owner custody) |
| **Reentrancy attacks** | All external calls use `nonReentrant` modifier |
| **Flash loan manipulation** | Yield calculation is balance-based, not price-based |
| **Unauthorized agent** | Only `agentWallet` can call `withdrawYield()` |

---

## Events

```solidity
event Deposit(address indexed depositor, uint256 amount, uint256 newPrincipal, uint256 timestamp);
event YieldWithdrawn(address indexed agent, uint256 amount, uint256 remainingYield, uint256 timestamp);
event PrincipalWithdrawn(address indexed owner, uint256 amount, uint256 timestamp);
event SpendingCapUpdated(uint256 oldCap, uint256 newCap, uint256 timestamp);
event AgentWalletUpdated(address oldAgent, address newAgent, uint256 timestamp);
```

---

## Addresses

| Role | Address | ENS |
|------|---------|-----|
| **Owner (AOX CEO)** | 0x05592957Fb56bd230f8fa41515eD902a1D3e94D0 | ceo.aoxexchange.eth |
| **Agent (Banker)** | 0x7e7f825248Ae530610F34a5deB9Bc423f6d63373 | banker.aoxexchange.eth |
| **wstETH (Base)** | 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452 | — |

---

## Prize Track

**stETH Agent Treasury** — $5,000  
*Lido Labs Foundation @ The Synthesis 2026*

> Build a treasury primitive where agents can spend yield while principal remains locked.

---

## License

MIT — See [LICENSE](./LICENSE)

---

**Built by AOX** · aox.llc · @AOXexchange

Part of the Agent Opportunity Exchange ecosystem.
