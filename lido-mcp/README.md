# Lido MCP Server

**Model Context Protocol (MCP) server for Lido Finance operations**

Built by AOX (@AOXexchange, aox.llc) for The Synthesis Ethereum Agent Hackathon 2026.

---

## 🚀 Live Server

**Status:** ✅ Running  
**Server:** `http://3.142.118.148:3300` (AWS EC2)  
**Wallet:** `0x7e7f825248Ae530610F34a5deB9Bc423f6d63373`  
**Process:** PID 116673 (managed via nohup)  
**Log:** `~/lido-mcp/server.log`

### Server Process
```bash
# Check if running
ps aux | grep "node index.js"

# View logs
tail -f ~/lido-mcp/server.log
```

---

## 🧪 Live Proof — Dry Run Results

Real transaction simulations executed on mainnet:

### Test 1: lido_stake (dry_run)
```json
{
  "success": true,
  "dry_run": true,
  "operation": "stake",
  "amount": "0.01",
  "amount_wei": "10000000000000000",
  "contract": "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  "network": "ethereum-mainnet",
  "estimated_stETH": "0.01",
  "gas_estimate": "0.015 ETH",
  "note": "Simulation only - no transaction executed",
  "timestamp": "2026-03-19T01:02:10.719Z"
}
```

### Test 2: lido_balance (live query)
```json
{
  "success": true,
  "address": "0x7e7f825248Ae530610F34a5deB9Bc423f6d63373",
  "stETH_balance": "0.0",
  "timestamp": "2026-03-19T01:02:12.145Z"
}
```

---

## 📋 Available Tools

| Tool | Description | Network |
|------|-------------|---------|
| `lido_stake` | Stake ETH for stETH | Ethereum Mainnet |
| `lido_unstake` | Request unstake (withdrawal queue) | Ethereum Mainnet |
| `lido_wrap` | Wrap stETH to wstETH | Base |
| `lido_unwrap` | Unwrap wstETH to stETH | Base |
| `lido_balance` | Check stETH/wstETH balances | Mainnet + Base |
| `lido_rewards` | Get staking rewards data | Mainnet + Base |

All write operations support `dry_run: true` for safe testing.

---

## 🔧 Installation

```bash
git clone https://github.com/GeObts/lido-mcp.git
cd lido-mcp
npm install
```

### Environment Setup

```bash
cp .env.example .env
# Edit .env with your private keys (never commit this file)
```

---

## 🚀 Running the Server

### Development
```bash
node index.js
```

### Production (with nohup)
```bash
nohup node index.js > server.log 2>&1 &
echo $! > server.pid
```

### Stop Server
```bash
kill $(cat server.pid)
```

---

## 🔒 Security

**⚠️ WARNING: This server handles real funds.**

- All private keys stored in `.env` (gitignored)
- Rate limiting: 10 calls/minute per tool
- Input validation for amounts (0.001-10 ETH for stakes)
- Dynamic gas pricing with 20% buffer
- `dry_run` mode available for all write operations
- Never commit real keys — use `.env.example` as template only

---

## 📡 Usage with MCP Clients

### Claude Desktop Config
```json
{
  "mcpServers": {
    "lido": {
      "command": "node",
      "args": ["/path/to/lido-mcp/index.js"],
      "env": {
        "BANKER_PRIVATE_KEY": "your-private-key"
      }
    }
  }
}
```

### Example Tool Calls

**Stake ETH (dry run):**
```json
{
  "tool": "lido_stake",
  "params": {
    "amount": "0.1",
    "dry_run": true
  }
}
```

**Check Balance:**
```json
{
  "tool": "lido_balance",
  "params": {
    "address": "0x7e7f825248Ae530610F34a5deB9Bc423f6d63373"
  }
}
```

---

## 🏆 Hackathon

**Event:** The Synthesis — Ethereum Agent Hackathon 2026  
**Team:** AOX (Agent Opportunity Exchange)  
**Prize Track:** Lido MCP ($5,000)  
**ERC-8004:** Both Marketplace and Banker agents registered  
**Repo:** https://github.com/GeObts/lido-mcp

---

## 📄 License

MIT — See [LICENSE](./LICENSE)

---

**Built by AOX** · aox.llc · @AOXexchange
