#!/bin/bash
# Test Case: Happy Path - Successful Transfer
# Alice ($100) sends $50 to Bob ($50)
# Expected: Alice → $50, Bob → $100, Transfer COMPLETED

TRANSACTION_SERVICE="http://localhost:3000"
WALLET_SERVICE="http://localhost:3001"

SENDER="11111111-1111-4111-a111-111111111111"
RECEIVER="22222222-2222-4222-a222-222222222222"
AMOUNT=5000  # $50.00

echo "🧪 Test: Happy Path - Successful Transfer"
echo "=========================================="
echo ""
echo "Scenario: Alice sends \$50 to Bob"
echo ""

# Check initial balances
echo "📊 Initial Balances:"
ALICE_BEFORE=$(curl -s "$WALLET_SERVICE/wallets/$SENDER" | jq -r '.balance')
BOB_BEFORE=$(curl -s "$WALLET_SERVICE/wallets/$RECEIVER" | jq -r '.balance')
echo "   Alice: $ALICE_BEFORE cents"
echo "   Bob:   $BOB_BEFORE cents"
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
ALICE_AFTER=$(curl -s "$WALLET_SERVICE/wallets/$SENDER" | jq -r '.balance')
BOB_AFTER=$(curl -s "$WALLET_SERVICE/wallets/$RECEIVER" | jq -r '.balance')
echo "   Alice: $ALICE_AFTER cents (was $ALICE_BEFORE)"
echo "   Bob:   $BOB_AFTER cents (was $BOB_BEFORE)"
echo ""

# Verify expectations
echo "✅ Verification:"
if [ "$FINAL_STATUS" = "COMPLETED" ]; then
  echo "   ✓ Transfer status is COMPLETED"
else
  echo "   ✗ Expected COMPLETED, got $FINAL_STATUS"
fi

EXPECTED_ALICE=$((ALICE_BEFORE - AMOUNT))
EXPECTED_BOB=$((BOB_BEFORE + AMOUNT))

if [ "$ALICE_AFTER" = "$EXPECTED_ALICE" ]; then
  echo "   ✓ Alice's balance decreased by $AMOUNT"
else
  echo "   ✗ Expected Alice balance $EXPECTED_ALICE, got $ALICE_AFTER"
fi

if [ "$BOB_AFTER" = "$EXPECTED_BOB" ]; then
  echo "   ✓ Bob's balance increased by $AMOUNT"
else
  echo "   ✗ Expected Bob balance $EXPECTED_BOB, got $BOB_AFTER"
fi
echo ""
