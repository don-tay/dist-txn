# Distributed Transaction System

A wallet-transaction system demonstrating the Saga pattern with choreography.

## Tech Stack

- **Framework**: NestJS (monorepo)
- **Message Broker**: Kafka
- **Database**: PostgreSQL
- **Language**: TypeScript (strict mode, ESM)

## Project Structure

```
dist-txn/
├── apps/
│   ├── transaction-service/   # Transfer initiation, saga coordination
│   └── wallet-service/        # Wallet CRUD, debit/credit operations
├── libs/
│   └── common/                # Shared constants, types, utilities
├── docker/
│   └── init-db.sql           # Database initialization script
├── docs/
│   └── SPECS.md              # Full specifications
├── img/                       # Architecture diagrams
├── docker-compose.yml         # PostgreSQL + Kafka infrastructure
└── package.json
```

## Quick Start

### 1. Start Infrastructure

```bash
# Start PostgreSQL and Kafka
npm run docker:up

# View logs
npm run docker:logs
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Run Services

```bash
# Terminal 1 - Transaction Service (port 3000)
npm run start:transaction-service:dev

# Terminal 2 - Wallet Service (port 3001)
npm run start:wallet-service:dev
```

### 4. Health Checks

```bash
# Transaction Service
curl http://localhost:3000/health

# Wallet Service
curl http://localhost:3001/health
```

## Development

### Linting

```bash
# Run ESLint with auto-fix
npm run lint

# Check only (no auto-fix)
npm run lint:check
```

### Formatting

```bash
# Format code with Prettier
npm run format

# Check formatting
npm run format:check
```

### Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e
```

## Services

| Service             | Port | Description                              |
| ------------------- | ---- | ---------------------------------------- |
| Transaction Service | 3000 | REST API for transfers                   |
| Wallet Service      | 3001 | REST API for wallets                     |
| PostgreSQL          | 5432 | Database (transaction_db + wallet_db)    |
| Kafka               | 9092 | Message broker                           |
| Kafka UI            | 8080 | Kafka management UI                      |

## Environment Variables

Create a `.env` file in the root:

```env
# Transaction Service Database
TRANSACTION_DB_HOST=localhost
TRANSACTION_DB_PORT=5432
TRANSACTION_DB_USER=transaction_user
TRANSACTION_DB_PASSWORD=transaction_pass
TRANSACTION_DB_NAME=transaction_db

# Wallet Service Database
WALLET_DB_HOST=localhost
WALLET_DB_PORT=5432
WALLET_DB_USER=wallet_user
WALLET_DB_PASSWORD=wallet_pass
WALLET_DB_NAME=wallet_db

# Kafka
KAFKA_BROKERS=localhost:9092
```

## Documentation

See [docs/SPECS.md](docs/SPECS.md) for full specifications including:

- Functional requirements
- Entity definitions
- API specifications
- Saga flow diagrams
