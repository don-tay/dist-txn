import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AppModule as TransactionAppModule } from '../apps/transaction-service/src/app.module';
import { AppModule as WalletAppModule } from '../apps/wallet-service/src/app.module';
import { SagaTimeoutService } from '../apps/transaction-service/src/application/services/saga-timeout.service';

/**
 * Saga Timeout E2E Tests
 *
 * Tests the saga timeout recovery mechanism for stuck transfers.
 * Uses direct database manipulation to create test scenarios where
 * transfers are "stuck" in non-terminal states past their timeout.
 *
 * Recovery Strategy:
 * - PENDING → FAILED: Debit never happened, safe to fail
 * - DEBITED → FAILED + compensation: Must refund sender
 *
 * Prerequisites:
 * - PostgreSQL running with wallet_db and transaction_db databases
 * - Kafka running on localhost:9092
 *
 * Run with: npm run test:e2e:timeout
 */
describe('Saga Timeout Recovery (e2e)', () => {
  let transactionApp: INestApplication;
  let walletApp: INestApplication;
  let transactionDataSource: DataSource;
  let walletDataSource: DataSource;
  let sagaTimeoutService: SagaTimeoutService;
  const logger = new Logger('SagaTimeoutE2ETest');

  // Use unique consumer groups per test run to avoid cross-test contamination
  const testRunId = Date.now().toString(36);
  const transactionConsumerGroup = `transaction-service-group-timeout-${testRunId}`;
  const walletConsumerGroup = `wallet-service-group-timeout-${testRunId}`;

  // Helper to wait for transfer status with polling delay
  const waitForTransferStatus = async (
    transferId: string,
    expectedStatus: string,
    maxWaitMs = 5000,
    pollIntervalMs = 50,
  ): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const result = await transactionDataSource.query(
        'SELECT status FROM transfers WHERE transfer_id = $1',
        [transferId],
      );
      if (result.length > 0 && result[0].status === expectedStatus) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(
      `Transfer did not reach status ${expectedStatus} within ${String(maxWaitMs)}ms`,
    );
  };

  // Helper to wait for wallet balance with polling delay
  const waitForBalance = async (
    walletId: string,
    expectedBalance: number,
    maxWaitMs = 5000,
    pollIntervalMs = 50,
  ): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const result = await walletDataSource.query(
        'SELECT balance FROM wallets WHERE wallet_id = $1',
        [walletId],
      );
      if (result.length > 0 && Number(result[0].balance) === expectedBalance) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    throw new Error(
      `Wallet did not reach balance ${String(expectedBalance)} within ${String(maxWaitMs)}ms`,
    );
  };

  beforeAll(async () => {
    const kafkaBroker = process.env['KAFKA_BROKER'] ?? 'localhost:9092';

    // Bootstrap Transaction Service
    const transactionModule: TestingModule = await Test.createTestingModule({
      imports: [TransactionAppModule],
    }).compile();

    transactionApp = transactionModule.createNestApplication();
    transactionApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    transactionApp.connectMicroservice<MicroserviceOptions>({
      transport: Transport.KAFKA,
      options: {
        client: {
          clientId: 'transaction-service-consumer-timeout',
          brokers: [kafkaBroker],
          retry: {
            initialRetryTime: 100,
            retries: 5,
          },
          connectionTimeout: 1000,
        },
        consumer: {
          groupId: transactionConsumerGroup,
          sessionTimeout: 6000,
          heartbeatInterval: 100,
          rebalanceTimeout: 5000,
        },
      },
    });

    await transactionApp.startAllMicroservices();
    await transactionApp.init();
    transactionDataSource = transactionApp.get(DataSource);
    sagaTimeoutService = transactionApp.get(SagaTimeoutService);

    // Bootstrap Wallet Service
    const walletModule: TestingModule = await Test.createTestingModule({
      imports: [WalletAppModule],
    }).compile();

    walletApp = walletModule.createNestApplication();
    walletApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    walletApp.connectMicroservice<MicroserviceOptions>({
      transport: Transport.KAFKA,
      options: {
        client: {
          clientId: 'wallet-service-consumer-timeout',
          brokers: [kafkaBroker],
          retry: {
            initialRetryTime: 100,
            retries: 5,
          },
          connectionTimeout: 1000,
        },
        consumer: {
          groupId: walletConsumerGroup,
          sessionTimeout: 6000,
          heartbeatInterval: 100,
          rebalanceTimeout: 5000,
        },
      },
    });

    await walletApp.startAllMicroservices();
    await walletApp.init();
    walletDataSource = walletApp.get(DataSource);

    logger.debug('Test services initialized for timeout tests');
  }, 60000);

  afterAll(async () => {
    await transactionApp.close();
    await walletApp.close();
  }, 30000);

  beforeEach(async () => {
    // Clean up tables before each test
    await transactionDataSource.query('TRUNCATE TABLE transfers CASCADE');
    await walletDataSource.query(
      'TRUNCATE TABLE wallet_ledger_entries, wallets, dead_letter_queue CASCADE',
    );
  });

  describe('PENDING Timeout Recovery', () => {
    it('should mark stuck PENDING transfer as FAILED', async () => {
      // 1. Create a transfer directly in DB with expired timeout
      const transferId = uuidv7();
      const senderWalletId = uuidv7();
      const receiverWalletId = uuidv7();
      const pastTimeout = new Date(Date.now() - 60000); // 1 minute ago

      await transactionDataSource.query(
        `INSERT INTO transfers 
         (transfer_id, sender_wallet_id, receiver_wallet_id, amount, status, timeout_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'PENDING', $5, $5, $5)`,
        [transferId, senderWalletId, receiverWalletId, 5000, pastTimeout],
      );

      // 2. Manually trigger the timeout handler
      await sagaTimeoutService.handleStuckTransfers();

      // 3. Verify transfer is now FAILED
      const result = await transactionDataSource.query(
        'SELECT status, failure_reason FROM transfers WHERE transfer_id = $1',
        [transferId],
      );

      expect(result[0].status).toBe('FAILED');
      expect(result[0].failure_reason).toContain('Saga timeout');
    });

    it('should not affect non-timed-out PENDING transfers', async () => {
      // 1. Create a transfer with future timeout
      const transferId = uuidv7();
      const senderWalletId = uuidv7();
      const receiverWalletId = uuidv7();
      const futureTimeout = new Date(Date.now() + 60000); // 1 minute from now

      await transactionDataSource.query(
        `INSERT INTO transfers 
         (transfer_id, sender_wallet_id, receiver_wallet_id, amount, status, timeout_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'PENDING', $5, NOW(), NOW())`,
        [transferId, senderWalletId, receiverWalletId, 5000, futureTimeout],
      );

      // 2. Trigger timeout handler
      await sagaTimeoutService.handleStuckTransfers();

      // 3. Verify transfer is still PENDING
      const result = await transactionDataSource.query(
        'SELECT status FROM transfers WHERE transfer_id = $1',
        [transferId],
      );

      expect(result[0].status).toBe('PENDING');
    });
  });

  describe('DEBITED Timeout Recovery with Compensation', () => {
    it('should mark stuck DEBITED transfer as FAILED and trigger refund', async () => {
      // 1. Create sender wallet with balance (simulating post-debit state)
      const userId = uuidv7();
      const walletResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId })
        .expect(201);
      const senderWalletId = walletResponse.body.walletId as string;

      // 2. Set up a balance that represents state AFTER debit
      const initialBalance = 5000; // Remaining after debit
      const transferAmount = 3000;
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [initialBalance, senderWalletId],
      );

      // 3. Create a stuck DEBITED transfer in DB
      const transferId = uuidv7();
      const receiverWalletId = uuidv7();
      const pastTimeout = new Date(Date.now() - 60000);

      await transactionDataSource.query(
        `INSERT INTO transfers 
         (transfer_id, sender_wallet_id, receiver_wallet_id, amount, status, timeout_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'DEBITED', $5, $5, $5)`,
        [
          transferId,
          senderWalletId,
          receiverWalletId,
          transferAmount,
          pastTimeout,
        ],
      );

      // 4. Create corresponding debit ledger entry (simulating successful debit)
      await walletDataSource.query(
        `INSERT INTO wallet_ledger_entries 
         (entry_id, wallet_id, transaction_id, type, amount, created_at)
         VALUES ($1, $2, $3, 'DEBIT', $4, NOW())`,
        [uuidv7(), senderWalletId, transferId, transferAmount],
      );

      // 5. Trigger timeout handler
      await sagaTimeoutService.handleStuckTransfers();

      // 6. Verify transfer is now FAILED
      await waitForTransferStatus(transferId, 'FAILED');

      const transferResult = await transactionDataSource.query(
        'SELECT status, failure_reason FROM transfers WHERE transfer_id = $1',
        [transferId],
      );
      expect(transferResult[0].status).toBe('FAILED');
      expect(transferResult[0].failure_reason).toContain('Saga timeout');

      // 7. Wait for compensation (refund) to complete
      const expectedBalance = initialBalance + transferAmount;
      await waitForBalance(senderWalletId, expectedBalance);

      // 8. Verify wallet balance was refunded
      const walletAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(walletAfter.body.balance).toBe(expectedBalance);

      // 9. Verify refund ledger entry exists
      const refundEntries = await walletDataSource.query(
        `SELECT * FROM wallet_ledger_entries 
         WHERE wallet_id = $1 AND type = 'REFUND'`,
        [senderWalletId],
      );
      expect(refundEntries).toHaveLength(1);
      expect(Number(refundEntries[0].amount)).toBe(transferAmount);
    }, 30000);

    it('should handle timeout compensation idempotently (no double refund)', async () => {
      // 1. Create sender wallet
      const userId = uuidv7();
      const walletResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId })
        .expect(201);
      const senderWalletId = walletResponse.body.walletId as string;

      const initialBalance = 5000;
      const transferAmount = 2000;
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [initialBalance, senderWalletId],
      );

      // 2. Create stuck DEBITED transfer
      const transferId = uuidv7();
      const receiverWalletId = uuidv7();
      const pastTimeout = new Date(Date.now() - 60000);

      await transactionDataSource.query(
        `INSERT INTO transfers 
         (transfer_id, sender_wallet_id, receiver_wallet_id, amount, status, timeout_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'DEBITED', $5, $5, $5)`,
        [
          transferId,
          senderWalletId,
          receiverWalletId,
          transferAmount,
          pastTimeout,
        ],
      );

      // 3. Create debit ledger entry
      await walletDataSource.query(
        `INSERT INTO wallet_ledger_entries 
         (entry_id, wallet_id, transaction_id, type, amount, created_at)
         VALUES ($1, $2, $3, 'DEBIT', $4, NOW())`,
        [uuidv7(), senderWalletId, transferId, transferAmount],
      );

      // 4. Trigger timeout handler TWICE
      await sagaTimeoutService.handleStuckTransfers();
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for events
      await sagaTimeoutService.handleStuckTransfers();

      // 5. Wait for compensation to complete before checking entries
      const expectedBalance = initialBalance + transferAmount;
      await waitForBalance(senderWalletId, expectedBalance);

      // 6. Verify only ONE refund entry exists (idempotent)
      const refundEntries = await walletDataSource.query(
        `SELECT * FROM wallet_ledger_entries 
         WHERE wallet_id = $1 AND type = 'REFUND'`,
        [senderWalletId],
      );
      expect(refundEntries).toHaveLength(1);

      // 8. Verify correct final balance (not double-refunded)
      const walletAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(walletAfter.body.balance).toBe(expectedBalance);
    }, 30000);
  });

  describe('Completed/Failed Transfers', () => {
    it('should not affect COMPLETED transfers', async () => {
      // Create a completed transfer with expired timeout
      const transferId = uuidv7();
      const pastTimeout = new Date(Date.now() - 60000);

      await transactionDataSource.query(
        `INSERT INTO transfers 
         (transfer_id, sender_wallet_id, receiver_wallet_id, amount, status, timeout_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $5, $5)`,
        [transferId, uuidv7(), uuidv7(), 5000, pastTimeout],
      );

      // Trigger timeout handler
      await sagaTimeoutService.handleStuckTransfers();

      // Verify still COMPLETED
      const result = await transactionDataSource.query(
        'SELECT status FROM transfers WHERE transfer_id = $1',
        [transferId],
      );
      expect(result[0].status).toBe('COMPLETED');
    });

    it('should not affect already FAILED transfers', async () => {
      // Create a failed transfer with expired timeout
      const transferId = uuidv7();
      const pastTimeout = new Date(Date.now() - 60000);

      await transactionDataSource.query(
        `INSERT INTO transfers 
         (transfer_id, sender_wallet_id, receiver_wallet_id, amount, status, failure_reason, timeout_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'FAILED', 'Original failure', $5, $5, $5)`,
        [transferId, uuidv7(), uuidv7(), 5000, pastTimeout],
      );

      // Trigger timeout handler
      await sagaTimeoutService.handleStuckTransfers();

      // Verify still FAILED with original reason
      const result = await transactionDataSource.query(
        'SELECT status, failure_reason FROM transfers WHERE transfer_id = $1',
        [transferId],
      );
      expect(result[0].status).toBe('FAILED');
      expect(result[0].failure_reason).toBe('Original failure');
    });
  });
});
