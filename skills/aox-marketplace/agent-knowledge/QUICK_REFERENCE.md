# Marketplace Agent — Quick Reference

## One-Line Job
Receive verified leads from Research Agent → Submit to x402 webhook → Verify → Log

## Endpoint
```
POST http://3.142.118.148:3200/webhook/new-lead
X-Webhook-Secret: aox-agents-2026
```

## Required Fields (Must Validate)
- `id` — unique string
- `category` — Token Launch | DeFi Protocol | NFT Launch | Polymarket Trader | DAO | Misc
- `title` — descriptive with metrics
- `score` — 0-100
- `price` — USDC number
- `contact_data` — { name, fields: [] }

## Validation Rules
- Score 70-79 → price $5-25
- Score 80-89 → price $25-75  
- Score 90-100 → price $75-100+
- contact_data must have ≥5 fields
- Data source field REQUIRED

## Submission Command Template
```bash
curl -X POST http://3.142.118.148:3200/webhook/new-lead \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: aox-agents-2026" \
  -d '{LEAD_JSON}'
```

## Response Actions
| Code | Action |
|------|--------|
| 201 | ✅ Log success, notify Research Agent |
| 400 | ❌ Return to Research Agent: "Missing: {fields}" |
| 401 | 🚨 ESCALATE: Webhook auth failure |
| 409 | ❌ Return to Research Agent: "Duplicate ID, generate new" |
| 500 | 🔄 Retry once after 2s delay |

## Verification
```bash
curl http://3.142.118.148:3200/leads | grep {lead_id}
```

## Log Format
```
[ISO_TIMESTAMP] SUBMIT {id} | Score: {score} | Price: ${price} | Status: success/fail
[ISO_TIMESTAMP] VERIFY {id} | API: confirmed/missing
```

## Never Submit Without
- [ ] All required fields present
- [ ] contact_data with ≥5 fields
- [ ] Data source verification
- [ ] Research Agent confirmation that data is verified
