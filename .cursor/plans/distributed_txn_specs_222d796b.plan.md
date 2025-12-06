---
name: Distributed Txn Specs
overview: Specifications for a distributed transaction learning project using the Saga pattern with choreography - includes entities, APIs, and saga flow.
todos:
  - id: create-specs-doc
    content: Create docs/SPECS.md with full specifications
    status: completed
  - id: cleanup-old-plans
    content: Delete old plan files after consolidation
    status: completed
---

# Distributed Transaction System - Specifications

## Overview

Create a `docs/SPECS.md` file documenting requirements for a wallet-transaction system demonstrating the Saga pattern with choreography.

---

## High-Level Architecture

[Architectural diagram](./img/hld.png)

**Key Design Principles:**

- **Service isolation**: Each service owns its database (no shared DB)
- **Async communication**: Services communicate via events, not direct calls
- **Choreography**: No central orchestrator; each service reacts to events
- **Idempotency**: All operations are idempotent via transaction_id

**Technology Decisions:**

| Component | Choice | Rationale |

|-----------|--------|-----------|

| Message Broker | Kafka | Learning opportunity; supports replay and partitioning |

| Event Format | Plain JSON | Simple; no schema registry overhead |

| Idempotency | DB-level | Unique constraint on `(wallet_id, transaction_id)` in WalletLedgerEntry |

| Observability | Basic | Structured logging + `/health` endpoints |

| Databases | PostgreSQL | ACID compliance, CHECK constraints for balance >= 0 |

| Framework | NestJS (monorepo) | TypeScript, modular architecture, good Kafka support |

**Service Ports:**

| Service | HTTP Port | Description |

|---------|-----------|-------------|

| Transaction Service | 3000 | REST API for transfers |

| Wallet Service | 3001 | REST API for wallets |

---

## 1. Functional Requirements

**Wallet Service**

- Create wallet (one per user)
- Query balance
- Debit operation (atomic, constraint-checked)
- Credit operation
- Compensation: refund failed debits

**Transaction Service**

- Initiate transfer (saga trigger)
- Query transfer status
- Track saga state machine (PENDING -> DEBITED -> COMPLETED / FAILED)

**Saga Events (Choreography)**

- `TransferInitiated` - Transaction Service publishes
- `SenderDebited` / `DebitFailed` - Wallet Service publishes
- `ReceiverCredited` / `CreditFailed` - Wallet Service publishes
- `DebitRefunded` - Wallet Service publishes (compensation)
- `TransferCompleted` / `TransferFailed` - Transaction Service publishes (terminal)

---

## 2. Non-Functional Requirements

- Idempotency via transaction IDs
- Eventual consistency (no distributed locks)
- Fail-fast, client-side retries
- Correlation IDs for distributed tracing
- Containerized local development (Docker Compose)

---

## 3. Out of Scope

- Authentication/authorization
- Multi-currency
- Rate limiting
- External payment integrations

---

## 4. Entities

### Wallet Service

**Wallet**

| Field | Type | Description |

|-------|------|-------------|

| wallet_id | UUID | Primary key |

| user_id | UUID | Owner (unique constraint) |

| balance | DECIMAL(19,4) | Non-negative constraint |

| created_at | TIMESTAMP | Creation time |

| updated_at | TIMESTAMP | Last update |

**WalletLedgerEntry** (idempotency + audit)

| Field | Type | Description |

|-------|------|-------------|

| entry_id | UUID | Primary key |

| wallet_id | UUID | FK to Wallet |

| transaction_id | UUID | Correlation ID (unique per wallet) |

| type | ENUM | DEBIT, CREDIT, REFUND |

| amount | DECIMAL(19,4) | Operation amount |

| created_at | TIMESTAMP | Entry time |

### Transaction Service

**Transfer**

| Field | Type | Description |

|-------|------|-------------|

| transfer_id | UUID | PK (saga correlation ID) |

| sender_wallet_id | UUID | Source wallet |

| receiver_wallet_id | UUID | Destination wallet |

| amount | DECIMAL(19,4) | Transfer amount |

| status | ENUM | PENDING, DEBITED, COMPLETED, FAILED |

| failure_reason | VARCHAR | Nullable |

| created_at | TIMESTAMP | Creation time |

| updated_at | TIMESTAMP | Last state change |

---

## 5. APIs

### Wallet Service (REST)

| Method | Endpoint | Description |

|--------|----------|-------------|

| POST | `/wallets` | Create wallet |

| GET | `/wallets/{wallet_id}` | Get wallet + balance |

### Transaction Service (REST)

| Method | Endpoint | Description |

|--------|----------|-------------|

| POST | `/transfers` | Initiate transfer |

| GET | `/transfers/{transfer_id}` | Query status |

### Event Topics

| Topic | Publisher | Consumers | Payload |

|-------|-----------|-----------|---------|

| `transfer.initiated` | Transaction Svc | Wallet Svc | transfer_id, sender_wallet_id, receiver_wallet_id, amount |

| `wallet.debited` | Wallet Svc | Wallet Svc, Transaction Svc | transfer_id, wallet_id |

| `wallet.debit-failed` | Wallet Svc | Transaction Svc | transfer_id, wallet_id, reason |

| `wallet.credited` | Wallet Svc | Transaction Svc | transfer_id, wallet_id |

| `wallet.credit-failed` | Wallet Svc | Wallet Svc | transfer_id, wallet_id, reason |

| `wallet.refunded` | Wallet Svc | Transaction Svc | transfer_id, wallet_id |

| `transfer.completed` | Transaction Svc | (External) | transfer_id |

| `transfer.failed` | Transaction Svc | (External) | transfer_id, reason |

---

## 6. Saga Flow

### Happy Path (Transfer Success)

[Transfer Success Flow](./img/trf-success.png)

### Compensation Path (Credit Fails)

[Wallet Credit Failure - Compensation Flow](./img/wallet-credit-fail.png)

### Early Failure Path (Debit Fails)

[Wallet Debit Failure Flow](./img/wallet-debit-fail.png)

---

## 7. Future Enhancements

Items deferred for later iterations:

- **Dead Letter Queue (DLQ)**: Handle messages that fail processing after retries
- **Retry with backoff**: Exponential backoff for transient failures
- **Saga timeout**: Auto-fail sagas stuck in intermediate states
- **Observability**: Metrics, distributed tracing spans, structured logging
- **Idempotency store cleanup**: TTL-based cleanup of processed transaction IDs

---

## 8. Implementation Approach

Using incremental development with TDD (test-driven development):

### Phase 0: Infrastructure Setup

- Docker Compose with PostgreSQL, message broker (RabbitMQ/Kafka)
- Service scaffolding with health checks
- CI pipeline for running tests

### Phase 1: Wallet Service (CRUD)

1. Write e2e tests: create wallet, get wallet, verify balance constraints
2. Implement Wallet entity + REST endpoints
3. Assert e2e tests pass

### Phase 2: Transaction Service (Transfer Initiation)

1. Write e2e tests: create transfer, query transfer status
2. Implement Transfer entity + REST endpoints
3. Assert e2e tests pass

### Phase 3: Event Integration (Happy Path)

1. Write e2e test: full transfer flow (initiate -> debit -> credit -> complete)
2. Implement event publishers and handlers
3. Assert e2e tests pass

### Phase 4: Compensation Flow

1. Write e2e tests: debit failure, credit failure with refund
2. Implement compensation handlers
3. Assert e2e tests pass

### TDD Workflow (per phase)

```
1. RED:   Write failing e2e test asserting expected behavior
2. GREEN: Implement minimal code to pass the test
3. REFACTOR: Clean up while keeping tests green
```

---

## Files to Create

- [`docs/SPECS.md`](docs/SPECS.md) - Main specifications document