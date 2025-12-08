#!/bin/bash
# Run all manual tests in sequence
# Reseeds data between each test for isolation

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       Distributed Transaction System - Manual Test Suite     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Test 1: Happy Path
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Resetting data..."
"$SCRIPT_DIR/seed-data.sh" > /dev/null
echo ""
"$SCRIPT_DIR/test-happy-path.sh"

read -p "Press Enter to continue..."
echo ""

# Test 2: Insufficient Funds
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Resetting data..."
"$SCRIPT_DIR/seed-data.sh" > /dev/null
echo ""
"$SCRIPT_DIR/test-insufficient-funds.sh"

read -p "Press Enter to continue..."
echo ""

# Test 3: Sender Not Found
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Resetting data..."
"$SCRIPT_DIR/seed-data.sh" > /dev/null
echo ""
"$SCRIPT_DIR/test-sender-not-found.sh"

read -p "Press Enter to continue..."
echo ""

# Test 4: Compensation
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Resetting data..."
"$SCRIPT_DIR/seed-data.sh" > /dev/null
echo ""
"$SCRIPT_DIR/test-compensation.sh"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ All tests completed!"
echo ""

# Final balances
"$SCRIPT_DIR/check-balances.sh"
