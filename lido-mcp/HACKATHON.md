# The Synthesis Hackathon 2026 — Lido MCP Submission

**Project**: Lido MCP Server  
**Prize Track**: Lido MCP Integration — $5,000  
**Team**: AOX (Agent Opportunity Exchange)  
**Website**: [aox.llc](https://aox.llc)  
**Twitter**: [@AOXexchange](https://twitter.com/AOXexchange)  
**GitHub**: [GeObts/lido-mcp](https://github.com/GeObts/lido-mcp)

---

## What We Built

A Model Context Protocol (MCP) server that makes Lido staking natively callable by any AI agent. The goal: a developer points Claude at this MCP server and stakes ETH from a conversation with **zero custom code**.

### Core Features

| Tool | Function | Chain |
|------|----------|-------|
| `lido_stake` | Stake ETH → receive stETH | Ethereum Mainnet |
| `lido_unstake` | Request stETH withdrawal → ETH | Ethereum Mainnet |
| `lido_wrap` | Convert stETH → wstETH (non-rebasing) | Base |
| `lido_unwrap` | Convert wstETH → stETH | Base |
| `lido_balance` | Check balances + APY across chains | Multi-chain |
| `lido_rewards` | Calculate rewards + projections | Multi-chain |

**All write operations support `dry_run: true` for safe simulation.**

---

## Technical Stack

- **Runtime**: Node.js 18+ with ES modules
- **MCP SDK**: `@modelcontextprotocol/sdk` v1.0.4
- **Blockchain**: Ethers.js v6 for Ethereum/Base interactions
- **RPC**: LlamaRPC (mainnet), Base native RPC
- **Contracts**: Lido stETH, wstETH on Base, Uniswap V3

---

## Live Demo Instructions

### Prerequisites
- Node.js 18+ installed
- Private key with ETH for gas (testnet or mainnet)

### Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/GeObts/lido-mcp.git
cd lido-mcp

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and add your private key:
# AOX_BANKER_PRIVATE_KEY=your_key_here

# 4. Start the server
npm start
```

### Connect to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lido": {
      "command": "node",
      "args": ["/path/to/lido-mcp/index.js"],
      "env": {
        "AOX_BANKER_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Restart Claude. The Lido tools appear automatically.

### Demo Conversation

**User**: "Stake 0.01 ETH"

**Claude**: *Simulates via `lido_stake` with `dry_run: true`*

> Simulation successful:
> - Stake: 0.01 ETH
> - Receive: ~0.01 stETH
> - Gas: ~0.015 ETH
> - APY: 3.2%
> 
> Proceed?

**User**: "Yes"

**Claude**: *Executes transaction*

> Done! Transaction confirmed:
> - Hash: `0x...`
> - stETH received: 0.00998
> - Now earning 3.2% APY

---

## AOX Integration

This MCP server powers the **Banker Agent** in the AOX autonomous pipeline:

1. **Marketplace Agent** sells leads → receives USDC
2. **Banker Agent** swaps 20% of USDC → ETH
3. **This MCP server** stakes ETH → stETH via `lido_stake`
4. Treasury earns 3-4% APY on idle funds

Fully autonomous. Zero human intervention.

---

## Why This Matters

**For AI Agents**: First-class blockchain access via natural language. No wallet management, no RPC configuration, no ABI parsing.

**For Developers**: Drop-in MCP server. One config entry. Instant Lido integration.

**For Users**: Stake ETH by talking to your AI. "Stake 0.1 ETH" → done.

---

## Judging Criteria Alignment

| Criteria | Status |
|----------|--------|
| AI-native experience | ✅ Zero custom code for users |
| Production-ready | ✅ Full error handling, dry-run support, gas estimation |
| Cross-chain support | ✅ Ethereum mainnet + Base L2 |
| Complete feature set | ✅ Stake, unstake, wrap, unwrap, balance, rewards |

---

## Links

- **Live Repo**: https://github.com/GeObts/lido-mcp
- **AOX Website**: https://aox.llc
- **AOX Twitter**: https://twitter.com/AOXexchange
- **Hackathon**: https://ethglobal.com/events/synthesis

---

*Built by AOX for The Synthesis Hackathon 2026*
