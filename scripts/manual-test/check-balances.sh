#!/bin/bash
# Check all wallet balances
# Useful for verifying state before/after tests

WALLET_SERVICE="http://localhost:3001"

echo "💰 Wallet Balances"
echo "=================="
echo ""

for wallet in \
  "11111111-1111-4111-a111-111111111111:Alice" \
  "22222222-2222-4222-a222-222222222222:Bob" \
  "33333333-3333-4333-a333-333333333333:Charlie" \
  "44444444-4444-4444-a444-444444444444:Diana"
do
  ID="${wallet%%:*}"
  NAME="${wallet##*:}"
  
  RESPONSE=$(curl -s "$WALLET_SERVICE/wallets/$ID")
  BALANCE=$(echo "$RESPONSE" | jq -r '.balance // "NOT FOUND"')
  
  if [ "$BALANCE" != "NOT FOUND" ]; then
    # Convert cents to dollars
    DOLLARS=$(echo "scale=2; $BALANCE / 100" | bc)
    printf "%-10s (%-36s): \$%s (%s cents)\n" "$NAME" "$ID" "$DOLLARS" "$BALANCE"
  else
    printf "%-10s (%-36s): NOT FOUND\n" "$NAME" "$ID"
  fi
done

echo ""
