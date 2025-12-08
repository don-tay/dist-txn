#!/bin/bash
# Test Case: Debit Fails - Sender Wallet Not Found
# Non-existent wallet tries to send to Bob
# Expected: Transfer FAILED, no compensation needed

TRANSACTION_SERVICE="http://localhost:3000"
WALLET_SERVICE="http://localhost:3001"

SENDER="99999999-9999-4999-a999-999999999999"  # Does not exist
RECEIVER="22222222-2222-4222-a222-222222222222"
AMOUNT=5000  # $50.00

echo "🧪 Test: Debit Fails - Sender Not Found"
echo "========================================"
echo ""
echo "Scenario: Non-existent wallet tries to send \$50 to Bob"
echo ""

# Check Bob's initial balance
echo "📊 Initial Balance:"
BOB_BEFORE=$(curl -s "$WALLET_SERVICE/wallets/$RECEIVER" | jq -r '.balance')
echo "   Bob: $BOB_BEFORE cents"
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

# Wait for saga to complete
echo "⏳ Waiting for saga to complete (1s)..."
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

# Check final balances
echo "📊 Final Balance:"
BOB_AFTER=$(curl -s "$WALLET_SERVICE/wallets/$RECEIVER" | jq -r '.balance')
echo "   Bob: $BOB_AFTER cents (was $BOB_BEFORE)"
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

if [ "$BOB_AFTER" = "$BOB_BEFORE" ]; then
  echo "   ✓ Bob's balance unchanged (no compensation needed)"
else
  echo "   ✗ Bob's balance changed unexpectedly"
fi
echo ""
