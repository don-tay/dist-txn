#!/bin/bash
# Seed test data into wallet_db
# Run this before manual testing to set up known wallet states

set -e

echo "🌱 Seeding test data into wallet_db..."

docker exec dist-txn-postgres psql -U wallet_user -d wallet_db -c "
-- Clear existing data for clean testing
TRUNCATE TABLE wallet_ledger_entries CASCADE;
TRUNCATE TABLE wallets CASCADE;

-- Insert seed wallets (using valid UUID v4 format)
INSERT INTO wallets (wallet_id, user_id, balance, created_at, updated_at) VALUES
  -- Alice: Rich wallet for successful transfers (10000 cents = \$100)
  ('11111111-1111-4111-a111-111111111111', 'aaaa1111-1111-4111-a111-111111111111', 10000, NOW(), NOW()),
  -- Bob: Recipient wallet (5000 cents = \$50)
  ('22222222-2222-4222-a222-222222222222', 'bbbb2222-2222-4222-a222-222222222222', 5000, NOW(), NOW()),
  -- Charlie: Poor wallet for insufficient funds test (0 cents)
  ('33333333-3333-4333-a333-333333333333', 'cccc3333-3333-4333-a333-333333333333', 0, NOW(), NOW()),
  -- Diana: Another rich wallet for compensation test (10000 cents = \$100)
  ('44444444-4444-4444-a444-444444444444', 'dddd4444-4444-4444-a444-444444444444', 10000, NOW(), NOW());
"

echo ""
echo "✅ Seed data inserted successfully!"
echo ""
echo "Test Wallets:"
echo "┌────────────────────────────────────────┬─────────┬─────────────┬────────────────────────────────┐"
echo "│ Wallet ID                              │ Owner   │ Balance     │ Purpose                        │"
echo "├────────────────────────────────────────┼─────────┼─────────────┼────────────────────────────────┤"
echo "│ 11111111-1111-4111-a111-111111111111   │ Alice   │ \$100.00     │ Sender for successful transfer │"
echo "│ 22222222-2222-4222-a222-222222222222   │ Bob     │ \$50.00      │ Receiver                       │"
echo "│ 33333333-3333-4333-a333-333333333333   │ Charlie │ \$0.00       │ Insufficient funds test        │"
echo "│ 44444444-4444-4444-a444-444444444444   │ Diana   │ \$100.00     │ Compensation test              │"
echo "└────────────────────────────────────────┴─────────┴─────────────┴────────────────────────────────┘"
