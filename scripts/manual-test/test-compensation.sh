#!/bin/bash
# Test Case: Compensation Path - Credit Fails, Refund Triggered
# Diana ($100) sends to non-existent wallet
# Expected: Debit succeeds → Credit fails → Refund compensation → Transfer FAILED
# Diana's balance should be restored

TRANSACTION_SERVICE="http://localhost:3000"
WALLET_SERVICE="http://localhost:3001"

SENDER="44444444-4444-4444-a444-444444444444"
RECEIVER="99999999-9999-4999-a999-999999999999"  # Does not exist
AMOUNT=5000  # $50.00

echo "🧪 Test: Compensation Path - Credit Fails, Refund"
echo "=================================================="
echo ""
echo "Scenario: Diana sends \$50 to non-existent wallet"
echo "Expected flow:"
echo "  1. Debit Diana (balance: \$100 → \$50)"
echo "  2. Credit fails (wallet not found)"
echo "  3. Compensation: Refund Diana (balance: \$50 → \$100)"
echo "  4. Transfer marked FAILED"
echo ""

# Check initial balance
echo "📊 Initial Balance:"
DIANA_BEFORE=$(curl -s "$WALLET_SERVICE/wallets/$SENDER" | jq -r '.balance')
echo "   Diana: $DIANA_BEFORE cents"
echo ""

# Initiate transfer
echo "📤 Initiating transfer..."
RESPONSE=$(curl -s -X POST "$TRANSACTION_SERVICE/transfers" \
  -H "Content-Type: application/json" \
  -d "{
    \"senderWalletId\": \"$SENDER\",
    \"receiverWalletId\": \"$RECEIVER\",
    \"amount\": $AMOUNT
  }")

TRANSFER_ID=$(echo "$RESPONSE" | jq -r '.transferId')
STATUS=$(echo "$RESPONSE" | jq -r '.status')

echo "   Transfer ID: $TRANSFER_ID"
echo "   Initial Status: $STATUS"
echo ""

# Wait for saga to complete (compensation takes longer)
echo "⏳ Waiting for saga + compensation to complete (1s)..."
sleep 1
echo ""

# Check final status
echo "📋 Final Transfer Status:"
FINAL=$(curl -s "$TRANSACTION_SERVICE/transfers/$TRANSFER_ID")
FINAL_STATUS=$(echo "$FINAL" | jq -r '.status')
FAILURE_REASON=$(echo "$FINAL" | jq -r '.failureReason // "none"')
echo "   Status: $FINAL_STATUS"
echo "   Failure Reason: $FAILURE_REASON"
echo ""

# Check final balance
echo "📊 Final Balance:"
DIANA_AFTER=$(curl -s "$WALLET_SERVICE/wallets/$SENDER" | jq -r '.balance')
echo "   Diana: $DIANA_AFTER cents (was $DIANA_BEFORE)"
echo ""

# Check ledger entries for Diana (shows debit + refund)
echo "📒 Diana's Ledger Entries (from DB):"
docker exec dist-txn-postgres psql -U wallet_user -d wallet_db -t -c "
SELECT type, amount, created_at 
FROM wallet_ledger_entries 
WHERE wallet_id = '$SENDER' 
ORDER BY created_at DESC 
LIMIT 5;
"
echo ""

# Verify expectations
echo "✅ Verification:"
if [ "$FINAL_STATUS" = "FAILED" ]; then
  echo "   ✓ Transfer status is FAILED"
else
  echo "   ✗ Expected FAILED, got $FINAL_STATUS"
fi

if [[ "$FAILURE_REASON" == *"Wallet not found"* ]]; then
  echo "   ✓ Failure reason mentions wallet not found"
else
  echo "   ✗ Expected failure reason to mention wallet not found"
fi

if [ "$DIANA_AFTER" = "$DIANA_BEFORE" ]; then
  echo "   ✓ Diana's balance restored (compensation successful)"
else
  echo "   ✗ Diana's balance not restored: expected $DIANA_BEFORE, got $DIANA_AFTER"
fi
echo ""
