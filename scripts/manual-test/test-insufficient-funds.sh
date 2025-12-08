#!/bin/bash
# Test Case: Debit Fails - Insufficient Funds
# Charlie ($0) tries to send $50 to Bob
# Expected: Transfer FAILED, no balance changes

TRANSACTION_SERVICE="http://localhost:3000"
WALLET_SERVICE="http://localhost:3001"

SENDER="33333333-3333-4333-a333-333333333333"
RECEIVER="22222222-2222-4222-a222-222222222222"
AMOUNT=5000  # $50.00

echo "🧪 Test: Debit Fails - Insufficient Funds"
echo "=========================================="
echo ""
echo "Scenario: Charlie (\$0) tries to send \$50 to Bob"
echo ""

# Check initial balances
echo "📊 Initial Balances:"
CHARLIE_BEFORE=$(curl -s "$WALLET_SERVICE/wallets/$SENDER" | jq -r '.balance')
BOB_BEFORE=$(curl -s "$WALLET_SERVICE/wallets/$RECEIVER" | jq -r '.balance')
echo "   Charlie: $CHARLIE_BEFORE cents"
echo "   Bob:     $BOB_BEFORE cents"
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
echo "📊 Final Balances:"
CHARLIE_AFTER=$(curl -s "$WALLET_SERVICE/wallets/$SENDER" | jq -r '.balance')
BOB_AFTER=$(curl -s "$WALLET_SERVICE/wallets/$RECEIVER" | jq -r '.balance')
echo "   Charlie: $CHARLIE_AFTER cents (was $CHARLIE_BEFORE)"
echo "   Bob:     $BOB_AFTER cents (was $BOB_BEFORE)"
echo ""

# Verify expectations
echo "✅ Verification:"
if [ "$FINAL_STATUS" = "FAILED" ]; then
  echo "   ✓ Transfer status is FAILED"
else
  echo "   ✗ Expected FAILED, got $FINAL_STATUS"
fi

if [[ "$FAILURE_REASON" == *"Insufficient balance"* ]]; then
  echo "   ✓ Failure reason mentions insufficient balance"
else
  echo "   ✗ Expected failure reason to mention insufficient balance"
fi

if [ "$CHARLIE_AFTER" = "$CHARLIE_BEFORE" ]; then
  echo "   ✓ Charlie's balance unchanged"
else
  echo "   ✗ Charlie's balance changed unexpectedly"
fi

if [ "$BOB_AFTER" = "$BOB_BEFORE" ]; then
  echo "   ✓ Bob's balance unchanged"
else
  echo "   ✗ Bob's balance changed unexpectedly"
fi
echo ""
