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

/**
 * Saga Integration E2E Tests
 *
 * Tests the full transfer saga flow across Transaction and Wallet services
 * via Kafka event choreography.
 *
 * Prerequisites:
 * - PostgreSQL running with wallet_db and transaction_db databases
 * - Kafka running on localhost:9092
 *
 * Run with: npm run test:e2e:saga
 */
describe('Transfer Saga (e2e)', () => {
  let transactionApp: INestApplication;
  let walletApp: INestApplication;
  let transactionDataSource: DataSource;
  let walletDataSource: DataSource;
  const logger = new Logger('SagaE2ETest');

  // Use unique consumer groups per test run to avoid cross-test contamination
  const testRunId = Date.now().toString(36);
  const transactionConsumerGroup = `transaction-service-group-saga-${testRunId}`;
  const walletConsumerGroup = `wallet-service-group-saga-${testRunId}`;

  // Helper to wait for async saga completion
  const waitForSagaCompletion = async (
    transferId: string,
    expectedStatus: string,
    maxWaitMs = 10000,
    intervalMs = 100,
  ): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const response = await request(transactionApp.getHttpServer())
        .get(`/transfers/${transferId}`)
        .expect(200);

      if (response.body.status === expectedStatus) {
        return;
      }

      // If terminal status reached but not expected, fail fast
      if (['COMPLETED', 'FAILED'].includes(response.body.status)) {
        if (response.body.status !== expectedStatus) {
          throw new Error(
            `Saga reached terminal status ${String(response.body.status)} (expected: ${expectedStatus}). ` +
              `Failure reason: ${String(response.body.failureReason) || 'none'}`,
          );
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `Saga did not reach status ${expectedStatus} within ${String(maxWaitMs)}ms`,
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

    // Connect Kafka microservice for consuming events
    transactionApp.connectMicroservice<MicroserviceOptions>({
      transport: Transport.KAFKA,
      options: {
        client: {
          clientId: 'transaction-service-consumer',
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

    // Connect Kafka microservice for consuming events
    walletApp.connectMicroservice<MicroserviceOptions>({
      transport: Transport.KAFKA,
      options: {
        client: {
          clientId: 'wallet-service-consumer',
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

    logger.debug('Test services initialized');
  }, 60000); // 60 second timeout for service initialization

  afterAll(async () => {
    // Give Kafka time to finish any pending operations
    await new Promise((resolve) => setTimeout(resolve, 100));
    await transactionApp.close();
    await walletApp.close();
  }, 30000); // 30 second timeout for cleanup

  beforeEach(async () => {
    // Clean up tables before each test using TRUNCATE for proper cascade handling
    await transactionDataSource.query('TRUNCATE TABLE transfers CASCADE');
    await walletDataSource.query(
      'TRUNCATE TABLE wallet_ledger_entries, wallets CASCADE',
    );
  });

  describe('Happy Path - Successful Transfer', () => {
    it('should complete a transfer between two wallets with sufficient balance', async () => {
      // 1. Create sender wallet with initial balance
      const senderUserId = uuidv7();
      const senderResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: senderUserId })
        .expect(201);
      const senderWalletId = senderResponse.body.walletId as string;

      // 2. Create receiver wallet
      const receiverUserId = uuidv7();
      const receiverResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: receiverUserId })
        .expect(201);
      const receiverWalletId = receiverResponse.body.walletId as string;

      // 3. Seed sender wallet with initial balance (direct DB update for test)
      const initialBalance = 10000; // $100.00 in cents
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [initialBalance, senderWalletId],
      );

      // Verify sender has balance
      const senderBefore = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(senderBefore.body.balance).toBe(initialBalance);

      // 4. Initiate transfer
      const transferAmount = 5000; // $50.00 in cents
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount: transferAmount,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;
      expect(transferResponse.body.status).toBe('PENDING');

      // 5. Wait for saga to complete
      await waitForSagaCompletion(transferId, 'COMPLETED');

      // 6. Verify final transfer status
      const finalTransfer = await request(transactionApp.getHttpServer())
        .get(`/transfers/${transferId}`)
        .expect(200);
      expect(finalTransfer.body.status).toBe('COMPLETED');
      expect(finalTransfer.body.failureReason).toBeNull();

      // 7. Verify sender balance decreased
      const senderAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(senderAfter.body.balance).toBe(initialBalance - transferAmount);

      // 8. Verify receiver balance increased
      const receiverAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${receiverWalletId}`)
        .expect(200);
      expect(receiverAfter.body.balance).toBe(transferAmount);
    }, 30000); // 30 second timeout for saga completion

    it('should create exactly two ledger entries (debit + credit) for a successful transfer', async () => {
      // Create wallets
      const senderUserId = uuidv7();
      const senderResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: senderUserId })
        .expect(201);
      const senderWalletId = senderResponse.body.walletId as string;

      const receiverUserId = uuidv7();
      const receiverResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: receiverUserId })
        .expect(201);
      const receiverWalletId = receiverResponse.body.walletId as string;

      // Seed sender balance
      const initialBalance = 10000;
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [initialBalance, senderWalletId],
      );

      // Create transfer
      const transferAmount = 3000;
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount: transferAmount,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // Wait for completion
      await waitForSagaCompletion(transferId, 'COMPLETED');

      // Verify final balances
      const senderAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(senderAfter.body.balance).toBe(initialBalance - transferAmount);

      const receiverAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${receiverWalletId}`)
        .expect(200);
      expect(receiverAfter.body.balance).toBe(transferAmount);

      // Verify only one debit and one credit ledger entry exist
      const ledgerCount = await walletDataSource.query(
        'SELECT COUNT(*) FROM wallet_ledger_entries WHERE transaction_id = $1',
        [transferId],
      );
      expect(parseInt(ledgerCount[0].count)).toBe(2); // 1 debit + 1 credit
    }, 30000);
  });

  describe('Failure Path - Insufficient Balance', () => {
    it('should fail transfer when sender has insufficient balance', async () => {
      // Create sender wallet with zero balance
      const senderUserId = uuidv7();
      const senderResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: senderUserId })
        .expect(201);
      const senderWalletId = senderResponse.body.walletId as string;

      // Create receiver wallet
      const receiverUserId = uuidv7();
      const receiverResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: receiverUserId })
        .expect(201);
      const receiverWalletId = receiverResponse.body.walletId as string;

      // Initiate transfer (sender has 0 balance)
      const transferAmount = 5000;
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount: transferAmount,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // Wait for saga to fail
      await waitForSagaCompletion(transferId, 'FAILED');

      // Verify transfer failed with reason
      const finalTransfer = await request(transactionApp.getHttpServer())
        .get(`/transfers/${transferId}`)
        .expect(200);
      expect(finalTransfer.body.status).toBe('FAILED');
      expect(finalTransfer.body.failureReason).toContain(
        'Insufficient balance',
      );

      // Verify both wallets unchanged
      const senderAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(senderAfter.body.balance).toBe(0);

      const receiverAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${receiverWalletId}`)
        .expect(200);
      expect(receiverAfter.body.balance).toBe(0);
    }, 30000);

    it('should fail transfer when sender wallet does not exist', async () => {
      // Create only receiver wallet
      const receiverUserId = uuidv7();
      const receiverResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: receiverUserId })
        .expect(201);
      const receiverWalletId = receiverResponse.body.walletId as string;

      const nonExistentSenderWalletId = uuidv7();

      // Initiate transfer
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId: nonExistentSenderWalletId,
          receiverWalletId,
          amount: 5000,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // Wait for saga to fail
      await waitForSagaCompletion(transferId, 'FAILED');

      // Verify transfer failed
      const finalTransfer = await request(transactionApp.getHttpServer())
        .get(`/transfers/${transferId}`)
        .expect(200);
      expect(finalTransfer.body.status).toBe('FAILED');
      expect(finalTransfer.body.failureReason).toContain('Wallet not found');
    }, 30000);
  });

  describe('Compensation Path - Credit Failure with Refund', () => {
    it('should refund sender when receiver wallet does not exist', async () => {
      // 1. Create sender wallet with balance
      const senderUserId = uuidv7();
      const senderResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: senderUserId })
        .expect(201);
      const senderWalletId = senderResponse.body.walletId as string;

      // Seed sender with initial balance
      const initialBalance = 10000; // $100.00 in cents
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [initialBalance, senderWalletId],
      );

      // 2. Use non-existent receiver wallet
      const nonExistentReceiverWalletId = uuidv7();

      // 3. Initiate transfer
      const transferAmount = 5000; // $50.00 in cents
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId: nonExistentReceiverWalletId,
          amount: transferAmount,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // 4. Wait for saga to fail (credit fails, then refund occurs)
      await waitForSagaCompletion(transferId, 'FAILED');

      // 5. Verify transfer failed with reason
      const finalTransfer = await request(transactionApp.getHttpServer())
        .get(`/transfers/${transferId}`)
        .expect(200);
      expect(finalTransfer.body.status).toBe('FAILED');
      expect(finalTransfer.body.failureReason).toContain('Wallet not found');

      // 6. Verify sender balance is restored (debit was refunded)
      // Give a small buffer for refund to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const senderAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(senderAfter.body.balance).toBe(initialBalance);
    }, 30000);

    it('should create debit and refund ledger entries after credit failure compensation', async () => {
      // 1. Create sender wallet with balance
      const senderUserId = uuidv7();
      const senderResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: senderUserId })
        .expect(201);
      const senderWalletId = senderResponse.body.walletId as string;

      // Seed sender with balance
      const initialBalance = 10000;
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [initialBalance, senderWalletId],
      );

      // 2. Non-existent receiver to trigger credit failure
      const nonExistentReceiverWalletId = uuidv7();

      // 3. Create transfer
      const transferAmount = 3000;
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId: nonExistentReceiverWalletId,
          amount: transferAmount,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // 4. Wait for saga completion and refund
      await waitForSagaCompletion(transferId, 'FAILED');
      // Extra wait for refund to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 5. Verify ledger entries: should have DEBIT and REFUND for sender
      const senderLedgerEntries = await walletDataSource.query(
        `SELECT type, amount FROM wallet_ledger_entries 
         WHERE wallet_id = $1 
         ORDER BY created_at ASC`,
        [senderWalletId],
      );

      expect(senderLedgerEntries).toHaveLength(2);
      expect(senderLedgerEntries[0].type).toBe('DEBIT');
      expect(Number(senderLedgerEntries[0].amount)).toBe(transferAmount);
      expect(senderLedgerEntries[1].type).toBe('REFUND');
      expect(Number(senderLedgerEntries[1].amount)).toBe(transferAmount);

      // 6. Verify no ledger entries for non-existent receiver
      const receiverLedgerEntries = await walletDataSource.query(
        `SELECT * FROM wallet_ledger_entries WHERE wallet_id = $1`,
        [nonExistentReceiverWalletId],
      );
      expect(receiverLedgerEntries).toHaveLength(0);

      // 7. Verify sender balance restored
      const senderAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(senderAfter.body.balance).toBe(initialBalance);
    }, 30000);

    it('should handle compensation idempotently when refund is replayed', async () => {
      // 1. Create sender wallet with balance
      const senderUserId = uuidv7();
      const senderResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: senderUserId })
        .expect(201);
      const senderWalletId = senderResponse.body.walletId as string;

      const initialBalance = 10000;
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [initialBalance, senderWalletId],
      );

      // 2. Non-existent receiver
      const nonExistentReceiverWalletId = uuidv7();

      // 3. Create transfer
      const transferAmount = 2000;
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId: nonExistentReceiverWalletId,
          amount: transferAmount,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // 4. Wait for saga completion
      await waitForSagaCompletion(transferId, 'FAILED');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 5. Verify only one refund entry exists (idempotency)
      const refundEntries = await walletDataSource.query(
        `SELECT * FROM wallet_ledger_entries 
         WHERE wallet_id = $1 AND type = 'REFUND'`,
        [senderWalletId],
      );
      expect(refundEntries).toHaveLength(1);

      // 6. Verify final balance is correct (not double-refunded)
      const senderAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(senderAfter.body.balance).toBe(initialBalance);
    }, 30000);
  });
});
