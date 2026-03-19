# Lido Skill — Mental Model for AI Agents

## What Lido Is

Lido is a **liquid staking protocol** for Ethereum. It allows users to stake ETH and receive **stETH** — a tokenized representation of staked ETH that remains liquid and earns staking rewards.

Traditional staking locks your ETH. Lido lets you earn rewards while keeping your capital liquid.

---

## Core Concepts

### stETH (Liquid Staked ETH)

- **Rebasing token**: Your balance automatically increases every day as staking rewards accrue
- **1 stETH ≈ 1 ETH** over time (though market price may vary)
- **Always earning**: No action required to claim rewards — they just appear
- **ERC-20 standard**: Can be used in DeFi, transferred, or held

**Example**: You hold 1 stETH today. In 30 days, you might hold 1.008 stETH without any transactions.

### wstETH (Wrapped stETH)

- **Non-rebasing token**: Your balance stays fixed, but the underlying value grows
- **DeFi preferred**: Many protocols prefer wstETH because the balance doesn't change
- **Base chain primarily**: Most wstETH activity happens on Base L2
- **Conversion**: 1 wstETH = X stETH, where X increases over time

**When to use which:**
- **stETH**: Holding, lending on Aave/Compound, simple staking
- **wstETH**: LP positions, collateral in fixed-balance systems, bridging to L2s

### The Rebase Mechanism

stETH balances update once per day (approximately every 24 hours). The "rebase" adds the day's staking rewards to all holder balances proportionally.

- Lido takes a 10% fee on staking rewards
- 90% goes to stETH holders
- Current APY: ~3-4% (varies with Ethereum staking rewards)

---

## Safe Staking Patterns

### Pattern 1: Simple Stake and Hold
1. Deposit ETH → Receive stETH
2. Hold stETH in wallet
3. Balance grows automatically
4. Lowest complexity, lowest gas

### Pattern 2: DeFi Yield Stacking
1. Stake ETH → stETH
2. Deposit stETH into Aave/Compound as collateral
3. Borrow ETH against it
4. Re-stake borrowed ETH
5. **Risk**: Leverage increases — liquidation possible

### Pattern 3: L2 Migration
1. Stake ETH → stETH on mainnet
2. Bridge to Base
3. Wrap to wstETH
4. Use in Base DeFi ecosystem

---

## Gas Considerations

| Operation | Network | Gas Cost |
|-----------|---------|----------|
| Stake ETH | Mainnet | ~0.015 ETH |
| Unstake (request) | Mainnet | ~0.02 ETH |
| Wrap stETH→wstETH | Base | ~0.001 ETH |
| Unwrap wstETH→stETH | Base | ~0.001 ETH |
| Transfer | Any | Minimal |

**Best practice**: Accumulate rewards on mainnet, then batch operations to save gas.

---

## Ethereum Mainnet vs Base

### Mainnet
- **Native staking**: Direct ETH → stETH conversion
- **Higher gas**: More expensive but most secure
- **Withdrawal queue**: Unstaking takes 1-5 days

### Base
- **L2 speed**: Faster, cheaper transactions
- **No direct staking**: Must bridge stETH from mainnet first
- **Primary use**: wstETH DeFi, lower-cost operations

**AOX Pattern**: Mainnet for staking/unstaking, Base for active DeFi management.

---

## EarnETH Vaults vs Direct Staking

### Direct Staking (stETH)
- You own the stETH directly
- Full liquidity — sell/transfer anytime
- You manage everything
- Lower fees (just Lido's 10%)

### EarnETH Vaults (Lido's managed product)
- Lido manages the staking strategy
- Potentially higher yields through optimization
- Less liquidity — withdrawal windows
- Additional fees for management

**AOX Recommendation**: Direct stETH for treasury funds. EarnETH only if idle for long periods.

---

## Risk Considerations

### Smart Contract Risk
- Lido has been audited extensively
- Multiple audits by Trail of Bits, Sigma Prime, etc.
- Contracts non-upgradeable (governance can only add features)

### Slashing Risk
- Validators can be slashed for misbehavior
- Lido spreads stake across many node operators
- Insurance fund covers minor slashing events

### Depeg Risk
- stETH trades close to ETH but can deviate
- Historically recovered to peg
- Worst case: trade stETH for ETH on Curve/Uniswap at slight discount

---

## Treasury Strategy (AOX Pattern)

**The Banker Agent Lido Strategy:**

1. Daily, sweep 20% of USDC proceeds to ETH
2. Bridge ETH to mainnet (if needed)
3. Stake via Lido → stETH
4. Accumulate stETH on mainnet
5. Weekly/monthly: Bridge excess to Base, wrap to wstETH
6. Deploy wstETH in low-risk DeFi (optional)

**Key Metrics to Track:**
- Total stETH equivalent across all chains
- Current APY vs alternatives (Aave, Compound)
- Gas costs vs reward accumulation
- Withdrawal queue depth (if unstaking)

---

## Quick Reference: Contract Addresses

```
Mainnet:
  Lido StETH: 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84
  Withdrawal Queue: 0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1

Base:
  wstETH: 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452
  stETH: 0xE3F4b4891bC8830e1D8228C85D1fBc05d762B77
```

---

## MCP Tool Mapping

| Intent | Tool | Notes |
|--------|------|-------|
| "Stake ETH" | `lido_stake` | Mainnet only |
| "Unstake my stETH" | `lido_unstake` | Creates withdrawal request |
| "Get wstETH on Base" | `lido_wrap` | stETH → wstETH |
| "Convert back to stETH" | `lido_unwrap` | wstETH → stETH |
| "Check my balance" | `lido_balance` | Cross-chain total |
| "How much have I earned?" | `lido_rewards` | Current APY + projections |
| "Vote on proposal 123" | `lido_governance_vote` | Requires voting power |

**Always use `dry_run: true` first for any write operation.**

---

## Common User Questions

**"Is my stETH safe?"**
Lido is the largest liquid staking protocol with $10B+ TVL. Smart contract risk exists but is minimized through audits and battle-tested code.

**"Can I lose money?"**
stETH can trade below ETH (depeg), but historically returns to peg. Slashing risk is covered by Lido's insurance. The ETH/stETH exchange rate only goes up.

**"Why is my balance different than expected?"**
stETH rebases daily. Check at the same time daily for accurate comparisons.

**"How do I get my ETH back?"**
Use `lido_unstake`. Withdrawals process in 1-5 days. You can also swap stETH for ETH instantly on DEXs (may have small slippage).

---

## Integration Notes for Agents

- All amounts in ETH/stETH terms (18 decimals)
- Always check balance before operations
- Gas estimation is approximate — real costs vary
- Unstaking is not instant — set user expectations
- Base operations require ETH for gas, not stETH
- Use `dry_run` extensively for validation
