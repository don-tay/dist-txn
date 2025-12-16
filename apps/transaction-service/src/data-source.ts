/**
 * TypeORM DataSource configuration for Transaction Service.
 *
 * This file is used by:
 * - TypeORM CLI commands (migrations, schema sync)
 * - E2E test setup scripts
 *
 * Uses the same entities as the runtime AppModule.
 */

import { DataSource } from 'typeorm';
import { TransferOrmEntity } from './infrastructure/persistence/transfer.orm-entity';
import { OutboxOrmEntity } from './infrastructure/persistence/outbox.orm-entity';

export const TransactionDataSource = new DataSource({
  type: 'postgres',
  host: process.env['TRANSACTION_DB_HOST'] ?? 'localhost',
  port: parseInt(process.env['TRANSACTION_DB_PORT'] ?? '5432', 10),
  username: process.env['TRANSACTION_DB_USER'] ?? 'transaction_user',
  password: process.env['TRANSACTION_DB_PASSWORD'] ?? 'transaction_pass',
  database: process.env['TRANSACTION_DB_NAME'] ?? 'transaction_db',
  entities: [TransferOrmEntity, OutboxOrmEntity],
  synchronize: false,
});
