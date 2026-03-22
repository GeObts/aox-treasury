# Marketplace Agent — Submission Checklist

## Before Submitting Any Lead

### Validation Checklist

**Critical (Must Pass):**
- [ ] `id` is present and is string format "{category}-{identifier}"
- [ ] `id` has not been used before (check if unsure)
- [ ] `category` is exactly one of: Token Launch, DeFi Protocol, NFT Launch, Polymarket Trader, DAO, Misc
- [ ] `title` is descriptive and includes key metrics (FDV, volume, traders)
- [ ] `score` is number between 0-100
- [ ] `price` is number and matches score tier
- [ ] `contact_data` is object with `name` and `fields` array
- [ ] `contact_data.fields` has at least 5 entries
- [ ] Data source is included in contact_data.fields

**Quality Checks:**
- [ ] Price appropriate for score (70-79: $5-25, 80-89: $25-75, 90-100: $75-100+)
- [ ] Title includes specific metrics ($X FDV, Y traders, Z volume)
- [ ] Description is 1-2 sentences, not generic
- [ ] Metadata has actual values, not placeholders

### Submission Steps

1. **Receive** lead JSON from Research Agent
2. **Validate** against checklist above
3. **If invalid**: Return to Research Agent with specific error message
4. **If valid**: Add timestamp fields (listed_at: ISO timestamp)
5. **Submit** to webhook endpoint
6. **Capture** response
7. **If success**: Verify via GET /leads endpoint
8. **Log** submission with timestamp, lead_id, score, price, status
9. **Confirm** to Research Agent: "Lead {id} listed successfully"

### Error Response Templates

**Missing Required Field:**
```
Lead rejected: Missing required field '{field}'. 
Required fields: id, category, title, score, price, contact_data.
Please provide complete lead JSON.
```

**Invalid Category:**
```
Lead rejected: Invalid category '{category}'. 
Must be one of: Token Launch, DeFi Protocol, NFT Launch, Polymarket Trader, DAO, Misc.
```

**Score Out of Range:**
```
Lead rejected: Score {score} is out of valid range (0-100).
```

**Price Mismatch:**
```
Lead rejected: Price ${price} is too high/low for score {score}.
Recommended price for score {score}: ${recommended_price}.
```

**Missing Contact Data:**
```
Lead rejected: contact_data must have at least 5 fields with verified contact information.
Current fields: {count}.
```

**Duplicate ID:**
```
Lead rejected: ID '{id}' already exists in marketplace.
Please generate new unique ID using format: {category}-{new_identifier}
```

### Post-Submission Verification

**Immediate (within 5 seconds):**
```bash
curl http://3.142.118.148:3200/lead?id={lead_id}
```
Expected: 402 response with payment requirements

**Short-term (within 60 seconds):**
```bash
curl http://3.142.118.148:3200/leads | grep {lead_id}
```
Expected: Lead appears in listings array

**Long-term (within 5 minutes):**
Check https://aox.llc — lead should appear in marketplace UI

### Success Criteria

Submission is SUCCESSFUL when:
- [ ] Webhook returns 201 with success message
- [ ] Lead appears in GET /leads response
- [ ] GET /lead?id={id} returns 402 (payment required)
- [ ] Lead logged in submissions.log
- [ ] Research Agent notified of success

Submission FAILED when:
- [ ] Any validation check fails
- [ ] Webhook returns 400/401/409/500
- [ ] Lead does not appear in API after 30 seconds
- [ ] Any error not resolved after retry

### Escalation Triggers

Escalate to CEO (AOX) immediately if:
- [ ] Webhook returns 401 (auth failure)
- [ ] Server health endpoint returns error
- [ ] Multiple submissions fail with 500 errors
- [ ] Research Agent insists on submitting unverified data
- [ ] Any security concerns with received data
