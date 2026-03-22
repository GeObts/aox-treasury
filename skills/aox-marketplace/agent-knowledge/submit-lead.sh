#!/bin/bash
# Marketplace Agent — Lead Submission Script
# Usage: ./submit-lead.sh lead.json

WEBHOOK_URL="http://3.142.118.148:3200/webhook/new-lead"
WEBHOOK_SECRET="aox-agents-2026"

if [ $# -eq 0 ]; then
    echo "Usage: $0 <lead.json>"
    echo "Example: $0 ./leads/token-abc123.json"
    exit 1
fi

LEAD_FILE="$1"

if [ ! -f "$LEAD_FILE" ]; then
    echo "Error: File not found: $LEAD_FILE"
    exit 1
fi

echo "Submitting lead from $LEAD_FILE..."
echo ""

# Submit to webhook
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "X-Webhook-Secret: $WEBHOOK_SECRET" \
    -d "@$LEAD_FILE")

BODY=$(echo "$RESPONSE" | sed '$d')
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"
echo ""

# Parse response
if [ "$HTTP_CODE" -eq 201 ]; then
    LEAD_ID=$(echo "$BODY" | grep -o '"lead_id":"[^"]*"' | cut -d'"' -f4)
    echo "✅ Lead submitted successfully!"
    echo "   Lead ID: $LEAD_ID"
    echo "   View: http://3.142.118.148:3200/lead?id=$LEAD_ID"
    
    # Verify in API
    sleep 2
    echo ""
    echo "Verifying in API..."
    VERIFY=$(curl -s "http://3.142.118.148:3200/leads" | grep "$LEAD_ID")
    if [ -n "$VERIFY" ]; then
        echo "✅ Lead confirmed in marketplace API"
    else
        echo "⚠️  Lead not yet visible in API (may take up to 60s)"
    fi
    
    exit 0
elif [ "$HTTP_CODE" -eq 409 ]; then
    echo "❌ Duplicate ID — lead already exists"
    exit 1
elif [ "$HTTP_CODE" -eq 400 ]; then
    echo "❌ Validation error — check lead JSON"
    exit 1
elif [ "$HTTP_CODE" -eq 401 ]; then
    echo "🚨 Authentication failed — webhook secret may be invalid"
    exit 1
else
    echo "❌ Submission failed (HTTP $HTTP_CODE)"
    exit 1
fi
