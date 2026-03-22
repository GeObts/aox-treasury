# HEARTBEAT.md — AOX

## Overview

I wake up every 2 hours and run through this checklist.

I also send my operator two daily reports — at 6:00 AM and 9:00 PM Mexico City time (CST, UTC-6).

I do not run unnecessary tasks. I do not burn credits on busywork.

Every heartbeat has a purpose.

---

## Heartbeat Schedule

| Task | Frequency |
|------|-----------|
| Agent health check | Every 2 hours |
| Pipeline failure check | Every 2 hours |
| Treasury balance check | Every 2 hours |
| New sales check | Every 2 hours |
| Morning report to operator | Daily at 6:00 AM CST |
| Evening report to operator | Daily at 9:00 PM CST |

---

## Every 2-Hour Heartbeat — Checklist

Run through these in order. Log the result of each step.

### Step 1 — Spawn Marketplace Agent

**SPAWN Marketplace Agent** with task:

> "You are the Marketplace Agent. Check your wallet 0x729174D90CA93139E3E9590993910B784eD32282 on Base mainnet. Do the following:
> 1) Get your ETH balance.
> 2) Get ALL token balances in your wallet — every single token regardless of what it is.
> 3) Transfer 100% of every token to the Banker wallet at 0x6350B793688221c75cfB438547B9CA47f5b0D4f1
# AgentTreasury: 0xeB747c50eD3b327480228E18ffD4bd9Cf8646B47 using cast send with the token contract transfer function.
> 4) Transfer all ETH above 0.002 ETH to the Banker wallet. Always keep exactly 0.002 ETH for gas.
> Use AOX_MARKETPLACE_PRIVATE_KEY from ~/.openclaw/.env.
> Log every transaction hash to ~/.openclaw/agents/marketplace/tx-log.md"

**Wait for Marketplace Agent to complete before spawning Banker Agent.**

**If Marketplace Agent fails:**
- Log the failure with timestamp and error
- Notify operator via Telegram immediately
- Do not proceed to Banker Agent

---

### Step 2 — Spawn Banker Agent

**SPAWN Banker Agent** with task (only after Marketplace confirms):

> "You are the Banker Agent. Check your wallet 0x6350B793688221c75cfB438547B9CA47f5b0D4f1
# AgentTreasury: 0xeB747c50eD3b327480228E18ffD4bd9Cf8646B47 on Base mainnet. Do the following:
> 1) Get ALL token balances and ETH balance.
> 2) Swap every non-USDC token and all ETH above 0.002 ETH to USDC using Uniswap V3 SwapRouter02 at 0x2626664c2603336E57B271c5C0b26F421741e481. WETH: 0x4200000000000000000000000000000000000006, USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, fee tier 500.
> 3) Once per day only: After swapping, take 20% of total USDC balance and stake into Lido EarnUSD vault on Base for yield.
> 4) Always keep 0.002 ETH for gas.
> Use AOX_BANKER_PRIVATE_KEY from ~/.openclaw/.env.
> Log every transaction hash and USDC balance to ~/.openclaw/agents/banker/tx-log.md"

**If Banker Agent fails:**
- Log the failure with timestamp and error
- Notify operator via Telegram immediately

---

### Step 3 — Agent Health Check (Legacy)

Check that Research and Scoring agents are available if needed:
- Research Agent — is it available for signal discovery?
- Scoring Agent — is it available for lead evaluation?

**Note:** Marketplace and Banker agents are now spawned on-demand every 2 hours rather than running continuously.

---

### Step 2 — Pipeline Failure Check

Check for any leads stuck in the pipeline:

- Any enriched leads waiting more than 2 hours for scoring?
- Any scored leads waiting more than 2 hours for listing?
- Any listed leads with payment confirmed but delivery not sent?

**If stuck items found:**
- Log the stuck item with details
- Notify operator via Telegram immediately with a brief description

**If pipeline is clear:**
- Log "Pipeline clear" with timestamp
- Continue to Step 3

---

### Step 3 — Treasury Balance Check

Check current USDC treasury balance.

Compare to balance from previous heartbeat.

Log:
- Current balance
- Change since last check (+ or -)
- Number of transactions since last check

**If balance unexpectedly decreased without a logged sale:**
- Flag as anomaly
- Notify operator immediately — do not wait for daily report

---

### Step 4 — New Sales Check

Check for any completed sales since last heartbeat.

For each new sale log:
- Lead ID
- Category
- Score
- Sale price
- Payment token received
- USDC amount after swap (if applicable)
- Transaction hash

**If no new sales:** Log "No new sales" and continue.

---

### Step 5 — Log Heartbeat Complete

Write a single summary log entry:
```
[HEARTBEAT] timestamp | agents: OK/WARN | pipeline: OK/WARN | treasury: $X USDC | sales: N
```

---

## Daily Morning Report — 6:00 AM CST

Send to operator via Telegram every morning at 6:00 AM Mexico City time.

**Format:**
```
☀️ AOX Morning Report — [DATE]

📡 Agents
- Research: [status]
- Scoring: [status] 
- Marketplace: [status]

🔍 Pipeline (last 24 hours)
- Signals discovered: N
- Leads scored: N
- Leads rejected: N (avg score: X)
- Leads listed: N

💰 Revenue (last 24 hours)
- Sales completed: N
- Revenue collected: $X USDC
- Treasury balance: $X USDC

⚠️ Issues
- [Any failures, anomalies, or warnings — or "None"]

💡 Observation
- [One insight, pattern, or recommendation based on yesterday's data]
```

---

## Daily Evening Report — 9:00 PM CST

Send to operator via Telegram every evening at 9:00 PM Mexico City time.

**Format:**
```
🌙 AOX Evening Report — [DATE]

📊 Today's Summary
- Signals discovered: N
- Leads listed: N
- Sales completed: N
- Revenue today: $X USDC
- Treasury balance: $X USDC

🔍 Top Lead Today
- Category: [type]
- Score: [X/100]
- Chain: Base
- Price: $X USDC

⚙️ System Status
- All agents: [OK / issues]
- Pipeline: [flowing / blocked]
- Last sale: [timestamp or "none today"]

🎯 Tomorrow
- [One priority or focus area for the next 24 hours]
```

---

## Immediate Alerts — Send Right Away

Do not wait for a scheduled report. Notify operator immediately via Telegram if:

- [ ] Any agent goes down and cannot be restarted
- [ ] Treasury balance drops unexpectedly
- [ ] Pipeline is blocked for more than 2 hours
- [ ] Any payment transaction fails
- [ ] Any suspicious or unauthorized activity detected

**Alert format:**
```
🚨 AOX ALERT — [timestamp]
Issue: [clear one-line description]
Status: [what is currently happening]
Action needed: [yes/no — and what if yes]
```

---

## What I Do NOT Do on Heartbeat

- I do not re-run work that already completed successfully
- I do not send reports if nothing has changed and there are no issues
- I do not call Venice API unless there is actual work to analyze
- I do not wake up more frequently than every 2 hours unless an alert condition is triggered
- I do not send duplicate alerts for the same ongoing issue

---

## Cron Schedule

```
# Every 2 hours — heartbeat
0 */2 * * * openclaw heartbeat

# 6:00 AM CST (12:00 UTC) — morning report 
0 12 * * * openclaw message --agent main "Generate and send morning report to operator"

# 9:00 PM CST (03:00 UTC next day) — evening report
0 3 * * * openclaw message --agent main "Generate and send evening report to operator"
```

---

## Log Location

All heartbeat logs are written to:
```
~/.openclaw/logs/heartbeat.log
```

**Format:**
```
[HEARTBEAT] 2026-03-14T20:00:00-06:00 | agents: OK | pipeline: OK | treasury: $240.00 USDC | sales: 3
```

## Moltbook Check-in (every 30 minutes)
If 30 minutes since last Moltbook check:
1. Call GET /api/v1/home to check notifications, DMs, and activity
2. Reply to any comments on my posts
3. Check feed for posts to upvote/comment on
4. Update lastMoltbookCheck timestamp

**API Key:** Stored securely in memory
**Profile:** https://www.moltbook.com/u/aox_ceo
