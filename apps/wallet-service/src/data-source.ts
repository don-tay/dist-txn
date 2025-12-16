/**
 * TypeORM DataSource configuration for Wallet Service.
 *
 * This file is used by:
 * - TypeORM CLI commands (migrations, schema sync)
 * - E2E test setup scripts
 *
 * Uses the same entities as the runtime AppModule.
 */

import { DataSource } from 'typeorm';
import { WalletOrmEntity } from './infrastructure/persistence/wallet.orm-entity';
import { WalletLedgerEntryOrmEntity } from './infrastructure/persistence/wallet-ledger-entry.orm-entity';
import { DeadLetterOrmEntity } from './infrastructure/persistence/dead-letter.orm-entity';
import { OutboxOrmEntity } from './infrastructure/persistence/outbox.orm-entity';

export const WalletDataSource = new DataSource({
  type: 'postgres',
  host: process.env['WALLET_DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['WALLET_DB_PORT'] ?? '5432', 10),
  username: process.env['WALLET_DB_USER'] ?? 'wallet_user',
  password: process.env['WALLET_DB_PASSWORD'] ?? 'wallet_pass',
  database: process.env['WALLET_DB_NAME'] ?? 'wallet_db',
  entities: [
    WalletOrmEntity,
    WalletLedgerEntryOrmEntity,
    DeadLetterOrmEntity,
    OutboxOrmEntity,
  ],
  synchronize: false,
});
