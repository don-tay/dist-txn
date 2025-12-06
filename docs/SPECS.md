# Distributed Transaction System - Specifications

A wallet-transaction system demonstrating the Saga pattern with choreography.

---

## High-Level Architecture

![Architectural diagram](../img/hld.png)

### Key Design Principles

- **Service isolation**: Each service owns its database (no shared DB)
- **Async communication**: Services communicate via events, not direct calls
- **Choreography**: No central orchestrator; each service reacts to events
- **Idempotency**: All operations are idempotent via transaction_id

### Technology Decisions

| Component      | Choice            | Rationale                                                               |
| -------------- | ----------------- | ----------------------------------------------------------------------- |
| Framework      | NestJS (monorepo) | TypeScript, modular architecture, good Kafka support                    |
| Message Broker | Kafka             | Learning opportunity; supports replay and partitioning                  |
| Event Format   | Plain JSON        | Simple; no schema registry overhead                                     |
| Idempotency    | DB-level          | Unique constraint on `(wallet_id, transaction_id)` in WalletLedgerEntry |
| Observability  | Basic             | Structured logging + `/health` endpoints                                |
| Databases      | PostgreSQL        | ACID compliance, CHECK constraints for balance >= 0                     |

### Service Ports

| Service             | HTTP Port | Description            |
| ------------------- | --------- | ---------------------- |
| Transaction Service | 3000      | REST API for transfers |
| Wallet Service      | 3001      | REST API for wallets   |

### DDD Architecture

Each service follows Domain-Driven Design with clear layer separation:

```
apps/{service}/src/
├── domain/                    # Domain Layer (core business logic)
│   ├── entities/              # Domain entities (Wallet, Transfer)
│   ├── value-objects/         # Immutable value types (Money, WalletId)
│   ├── events/                # Domain events
│   ├── services/              # Domain services
│   └── repositories/          # Repository interfaces (ports)
├── application/               # Application Layer (use cases)
│   ├── commands/              # Command handlers (write operations)
│   ├── queries/               # Query handlers (read operations)
│   ├── services/              # Application services
│   └── dtos/                  # Data transfer objects
├── infrastructure/            # Infrastructure Layer (adapters)
│   ├── persistence/           # TypeORM repositories, entities
│   └── messaging/             # Kafka producers/consumers
└── interface/                 # Interface Layer (entry points)
    └── http/                  # REST controllers
```

**Layer Dependencies (Dependency Rule):**

```
Interface → Application → Domain
                ↑
Infrastructure (implements Domain interfaces)
```

**Key DDD Concepts Applied:**

| Concept | Implementation |
| ------- | -------------- |
| Aggregate Root | `Wallet` (owns WalletLedgerEntry), `Transfer` |
| Value Object | `Money`, `WalletId`, `TransferId` |
| Domain Event | `WalletDebited`, `TransferInitiated` |
| Repository | Interface in domain, implementation in infrastructure |
| Domain Service | Business logic spanning multiple aggregates |

### Coding Conventions

#### Input Validation

Use NestJS `ValidationPipe` with `class-validator` decorators for all controller input validation:

```typescript
// main.ts - Enable globally
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,           // Strip non-decorated properties
    forbidNonWhitelisted: true, // Error on extra properties
    transform: true,            // Auto-transform to DTO instances
  }),
);

// DTO with validation decorators
export class CreateWalletDto {
  @IsUUID()
  user_id!: string;
}
```

#### Object Transformation

Use `class-transformer` with `@Expose()` decorators for all entity/DTO transformations:

```typescript
// Entity with @Expose() decorators
export class Wallet {
  @Expose() readonly walletId: string;
  @Expose() readonly userId: string;
  @Expose() readonly balance: number;
  // ...
}

// Repository: Use plainToInstance for both directions
async save(wallet: Wallet): Promise<Wallet> {
  const ormEntity = plainToInstance(WalletOrmEntity, wallet, {
    excludeExtraneousValues: true,
  });
  const saved = await this.ormRepository.save(ormEntity);
  return plainToInstance(Wallet, saved, { excludeExtraneousValues: true });
}

async findById(walletId: string): Promise<Wallet | null> {
  const entity = await this.ormRepository.findOne({ where: { walletId } });
  return entity
    ? plainToInstance(Wallet, entity, { excludeExtraneousValues: true })
    : null;
}
```

Key options:
- `excludeExtraneousValues: true` - Only include properties with `@Expose()`

#### Type Safety

TypeScript uses structural typing - leverage it instead of excessive type guards:

- Trust typed function parameters and return types
- Use `plainToInstance` with decorated classes for transformations
- Use `satisfies` for object literal type checking without widening

```typescript
// ✅ Good: satisfies for config objects
const config = {
  host: 'localhost',
  port: 5432,
} satisfies DbConfig;

// ✅ Good: Use plainToInstance consistently
const wallet = plainToInstance(Wallet, {
  walletId: randomUUID(),
  userId,
  balance: 0,
  createdAt: now,
  updatedAt: now,
}, { excludeExtraneousValues: true });
```

#### Immutability

Prefer immutability and avoid mutation/side effects:

- **Domain entities**: Use `readonly` for identity fields, private constructor with factory methods
- **Props interfaces**: Mark all properties as `readonly`
- **Object creation**: Use spread/`Object.assign` instead of sequential mutation

```typescript
// ❌ Avoid: Sequential mutation
const plain: Record<string, unknown> = { wallet_id: wallet.walletId };
plain['user_id'] = wallet.userId;
if (includeUpdatedAt) {
  plain['updated_at'] = wallet.updatedAt;
}

// ✅ Prefer: Spread with conditional
const plain = {
  wallet_id: wallet.walletId,
  user_id: wallet.userId,
  ...(includeUpdatedAt && { updated_at: wallet.updatedAt }),
};

// ❌ Avoid: Field-by-field assignment
const entity = new WalletOrmEntity();
entity.walletId = wallet.walletId;
entity.userId = wallet.userId;

// ✅ Prefer: Object.assign in single expression
return Object.assign(new WalletOrmEntity(), {
  walletId: wallet.walletId,
  userId: wallet.userId,
});
```

---

## 1. Functional Requirements

### Wallet Service

- Create wallet (one per user)
- Query balance
- Debit operation (atomic, constraint-checked)
- Credit operation
- Compensation: refund failed debits

### Transaction Service

- Initiate transfer (saga trigger)
- Query transfer status
- Track saga state machine (PENDING -> DEBITED -> COMPLETED / FAILED)

### Saga Events (Choreography)

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

#### Wallet

| Field      | Type      | Description                          |
| ---------- | --------- | ------------------------------------ |
| wallet_id  | UUID      | Primary key                          |
| user_id    | UUID      | Owner (unique constraint)            |
| balance    | BIGINT    | Balance in cents, non-negative       |
| created_at | TIMESTAMP | Creation time                        |
| updated_at | TIMESTAMP | Last update                          |

> **Note:** All monetary amounts are stored in cents (integer) to avoid floating-point precision issues.
> PostgreSQL `bigint` returns as string; use TypeORM column transformer for automatic conversion.

#### WalletLedgerEntry (idempotency + audit)

| Field          | Type      | Description                        |
| -------------- | --------- | ---------------------------------- |
| entry_id       | UUID      | Primary key                        |
| wallet_id      | UUID      | FK to Wallet                       |
| transaction_id | UUID      | Correlation ID (unique per wallet) |
| type           | ENUM      | DEBIT, CREDIT, REFUND              |
| amount         | BIGINT    | Amount in cents                    |
| created_at     | TIMESTAMP | Entry time                         |

**Constraints:**

- Unique constraint on `(wallet_id, transaction_id)` for idempotency
- Foreign key from `wallet_id` to `Wallet.wallet_id`

### Transaction Service

#### Transfer

| Field              | Type      | Description                         |
| ------------------ | --------- | ----------------------------------- |
| transfer_id        | UUID      | PK (saga correlation ID)            |
| sender_wallet_id   | UUID      | Source wallet                       |
| receiver_wallet_id | UUID      | Destination wallet                  |
| amount             | BIGINT    | Transfer amount in cents            |
| status             | ENUM      | PENDING, DEBITED, COMPLETED, FAILED |
| failure_reason     | VARCHAR   | Nullable                            |
| created_at         | TIMESTAMP | Creation time                       |
| updated_at         | TIMESTAMP | Last state change                   |

---

## 5. APIs

### Wallet Service (REST)

| Method | Endpoint               | Description          |
| ------ | ---------------------- | -------------------- |
| POST   | `/wallets`             | Create wallet        |
| GET    | `/wallets/{wallet_id}` | Get wallet + balance |

#### POST /wallets

**Request:**

```json
{
  "user_id": "uuid"
}
```

**Response (201 Created):**

```json
{
  "wallet_id": "uuid",
  "user_id": "uuid",
  "balance": 0,
  "created_at": "timestamp"
}
```

#### GET /wallets/{wallet_id}

**Response (200 OK):**

```json
{
  "wallet_id": "uuid",
  "user_id": "uuid",
  "balance": 10000,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### Transaction Service (REST)

| Method | Endpoint                   | Description       |
| ------ | -------------------------- | ----------------- |
| POST   | `/transfers`               | Initiate transfer |
| GET    | `/transfers/{transfer_id}` | Query status      |

#### POST /transfers

**Request:**

```json
{
  "sender_wallet_id": "uuid",
  "receiver_wallet_id": "uuid",
  "amount": 5000
}
```

**Response (202 Accepted):**

```json
{
  "transfer_id": "uuid",
  "status": "PENDING",
  "created_at": "timestamp"
}
```

#### GET /transfers/{transfer_id}

**Response (200 OK):**

```json
{
  "transfer_id": "uuid",
  "sender_wallet_id": "uuid",
  "receiver_wallet_id": "uuid",
  "amount": 5000,
  "status": "COMPLETED",
  "failure_reason": null,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### Event Topics (Kafka)

| Topic                  | Publisher       | Consumers                   | Payload                                                   |
| ---------------------- | --------------- | --------------------------- | --------------------------------------------------------- |
| `transfer.initiated`   | Transaction Svc | Wallet Svc                  | transfer_id, sender_wallet_id, receiver_wallet_id, amount |
| `wallet.debited`       | Wallet Svc      | Wallet Svc, Transaction Svc | transfer_id, wallet_id                                    |
| `wallet.debit-failed`  | Wallet Svc      | Transaction Svc             | transfer_id, wallet_id, reason                            |
| `wallet.credited`      | Wallet Svc      | Transaction Svc             | transfer_id, wallet_id                                    |
| `wallet.credit-failed` | Wallet Svc      | Wallet Svc                  | transfer_id, wallet_id, reason                            |
| `wallet.refunded`      | Wallet Svc      | Transaction Svc             | transfer_id, wallet_id                                    |
| `transfer.completed`   | Transaction Svc | (External)                  | transfer_id                                               |
| `transfer.failed`      | Transaction Svc | (External)                  | transfer_id, reason                                       |

---

## 6. Saga Flow

### Happy Path (Transfer Success)

![Transfer Success Flow](../img/trf-success.png)

**Sequence:**

1. Client -> POST /transfers -> Transaction Service
2. Transaction Service creates Transfer (PENDING), publishes `transfer.initiated`
3. Wallet Service debits sender, publishes `wallet.debited`
4. Wallet Service credits receiver, publishes `wallet.credited`
5. Transaction Service updates Transfer (COMPLETED), publishes `transfer.completed`

### Compensation Path (Credit Fails)

![Wallet Credit Failure - Compensation Flow](../img/wallet-credit-fail.png)

**Sequence:**

1. After successful debit, credit to receiver fails
2. Wallet Service publishes `wallet.credit-failed`
3. Wallet Service refunds sender (compensation), publishes `wallet.refunded`
4. Transaction Service updates Transfer (FAILED), publishes `transfer.failed`

### Early Failure Path (Debit Fails)

![Wallet Debit Failure Flow](../img/wallet-debit-fail.png)

**Sequence:**

1. Debit fails (insufficient funds, wallet not found)
2. Wallet Service publishes `wallet.debit-failed`
3. Transaction Service updates Transfer (FAILED), publishes `transfer.failed`
4. No compensation needed (nothing to rollback)

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

- Docker Compose with PostgreSQL, Kafka
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
