/**
 * E2E Test Database Setup
 *
 * Synchronizes database schemas using the actual TypeORM DataSource
 * configurations from each service. Run before e2e tests via:
 *
 *   npm run test:e2e
 *
 * This ensures test database schemas match entity definitions exactly.
 */

/* eslint-disable no-console */

import { TransactionDataSource } from '../apps/transaction-service/src/data-source';
import { WalletDataSource } from '../apps/wallet-service/src/data-source';

async function setup(): Promise<void> {
  console.log('\n🔧 Setting up e2e test databases...');

  // Synchronize Transaction database
  await TransactionDataSource.initialize();
  await TransactionDataSource.synchronize(true);
  console.log('  ✅ Transaction database schema synchronized');
  await TransactionDataSource.destroy();

  // Synchronize Wallet database
  await WalletDataSource.initialize();
  await WalletDataSource.synchronize(true);
  console.log('  ✅ Wallet database schema synchronized');
  await WalletDataSource.destroy();

  console.log('🚀 Database setup complete!\n');
}

setup().catch((error: unknown) => {
  console.error('❌ Database setup failed:', error);
  process.exit(1);
});
