# Manual Test Scripts

Shell scripts for manually testing the Distributed Transaction System saga flows.

## Prerequisites

- Docker containers running (`docker-compose up -d`)
- Both services running:
  - Transaction Service: `npm run start:transaction-service:dev` (port 3000)
  - Wallet Service: `npm run start:wallet-service:dev` (port 3001)
- `jq` installed for JSON parsing
- `bc` installed for arithmetic (usually pre-installed)

## Test Wallets

| Wallet ID | Owner | Initial Balance | Purpose |
|-----------|-------|-----------------|---------|
| `11111111-1111-4111-a111-111111111111` | Alice | $100.00 | Sender for successful transfers |
| `22222222-2222-4222-a222-222222222222` | Bob | $50.00 | Receiver |
| `33333333-3333-4333-a333-333333333333` | Charlie | $0.00 | Insufficient funds test |
| `44444444-4444-4444-a444-444444444444` | Diana | $100.00 | Compensation test |

## Scripts

### Setup & Utilities

| Script | Description |
|--------|-------------|
| `seed-data.sh` | Reset database and insert test wallets |
| `check-balances.sh` | Display current balances of all test wallets |
| `health-check.sh` | Check health of both services |

### Test Cases

| Script | Scenario | Expected Result |
|--------|----------|-----------------|
| `test-happy-path.sh` | Alice → Bob ($50) | Transfer COMPLETED, balances updated |
| `test-insufficient-funds.sh` | Charlie → Bob ($50) | Transfer FAILED (insufficient balance) |
| `test-sender-not-found.sh` | Non-existent → Bob | Transfer FAILED (wallet not found) |
| `test-compensation.sh` | Diana → Non-existent | Debit → Credit fails → Refund → FAILED |

### Run All Tests

```bash
./run-all-tests.sh
```

Runs all tests sequentially with data reset between each test.

## Usage

```bash
# Make scripts executable (first time only)
chmod +x scripts/manual-test/*.sh

# Seed data
./scripts/manual-test/seed-data.sh

# Run individual test
./scripts/manual-test/test-happy-path.sh

# Run all tests
./scripts/manual-test/run-all-tests.sh
```

## Saga Flow Reference

### Happy Path
```
Client → POST /transfers → Transaction Service
  → transfer.initiated → Wallet Service (debit sender)
    → wallet.debited → Wallet Service (credit receiver)
      → wallet.credited → Transaction Service
        → Transfer COMPLETED
```

### Compensation Path (Credit Fails)
```
Client → POST /transfers → Transaction Service
  → transfer.initiated → Wallet Service (debit sender)
    → wallet.debited → Wallet Service (credit fails)
      → wallet.credit-failed → Wallet Service (refund sender)
        → wallet.refunded → Transaction Service
          → Transfer FAILED
```

### Early Failure (Debit Fails)
```
Client → POST /transfers → Transaction Service
  → transfer.initiated → Wallet Service (debit fails)
    → wallet.debit-failed → Transaction Service
      → Transfer FAILED (no compensation needed)
```
