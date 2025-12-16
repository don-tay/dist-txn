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
import { OutboxPublisherService as TransactionOutboxPublisher } from '../apps/transaction-service/src/application/services/outbox-publisher.service';

/**
 * Outbox Pattern E2E Tests
 *
 * Tests the transactional outbox pattern for reliable event publishing.
 * Verifies that:
 * 1. Domain changes and outbox entries are written atomically
 * 2. Outbox publisher picks up and publishes events
 * 3. Events are marked as published after successful Kafka delivery
 * 4. The full saga works correctly via outbox-based publishing
 *
 * Prerequisites:
 * - PostgreSQL running with wallet_db and transaction_db databases
 * - Kafka running on localhost:9092
 *
 * Run with: npm run test:e2e:outbox
 */
describe('Outbox Pattern (e2e)', () => {
  let transactionApp: INestApplication;
  let walletApp: INestApplication;
  let transactionDataSource: DataSource;
  let walletDataSource: DataSource;
  let transactionOutboxPublisher: TransactionOutboxPublisher;
  const logger = new Logger('OutboxE2ETest');

  // Use unique consumer groups per test run to avoid cross-test contamination
  const testRunId = Date.now().toString(36);
  const transactionConsumerGroup = `transaction-service-group-outbox-${testRunId}`;
  const walletConsumerGroup = `wallet-service-group-outbox-${testRunId}`;

  // Helper to wait for saga completion
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

  // Helper to wait for outbox entries to be published
  const waitForOutboxPublished = async (
    dataSource: DataSource,
    aggregateId: string,
    maxWaitMs = 5000,
  ): Promise<void> => {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const unpublished = await dataSource.query(
        `SELECT COUNT(*) FROM outbox 
         WHERE aggregate_id = $1 AND published_at IS NULL`,
        [aggregateId],
      );
      if (parseInt(unpublished[0].count) === 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `Outbox entries for ${aggregateId} were not all published within ${String(maxWaitMs)}ms`,
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
          clientId: 'transaction-service-consumer-outbox',
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
    transactionOutboxPublisher = transactionApp.get(TransactionOutboxPublisher);

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
          clientId: 'wallet-service-consumer-outbox',
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

    // Synchronize databases
    await transactionDataSource.synchronize(true);
    await walletDataSource.synchronize(true);

    logger.debug('Test services initialized for outbox tests');
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await transactionApp.close();
    await walletApp.close();
  }, 30000);

  beforeEach(async () => {
    // Clean up tables before each test
    await transactionDataSource.query(
      'TRUNCATE TABLE outbox, transfers CASCADE',
    );
    await walletDataSource.query(
      'TRUNCATE TABLE outbox, wallet_ledger_entries, wallets, dead_letter_queue CASCADE',
    );
  });

  describe('Outbox Entry Creation', () => {
    it('should create outbox entry atomically with transfer creation', async () => {
      // 1. Create wallets
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
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [10000, senderWalletId],
      );

      // 2. Create transfer
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount: 5000,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // 3. Verify outbox entry was created for TransferInitiated
      const outboxEntries = await transactionDataSource.query(
        `SELECT * FROM outbox WHERE aggregate_id = $1`,
        [transferId],
      );

      expect(outboxEntries.length).toBeGreaterThanOrEqual(1);
      const initiatedEntry = outboxEntries.find(
        (e: { event_type: string }) => e.event_type === 'TransferInitiated',
      );
      expect(initiatedEntry).toBeDefined();
      expect(initiatedEntry.aggregate_type).toBe('Transfer');
      expect(initiatedEntry.payload).toMatchObject({
        transferId,
        senderWalletId,
        receiverWalletId,
        amount: 5000,
      });
    });

    it('should create outbox entry atomically with wallet debit', async () => {
      // 1. Create wallets
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
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [10000, senderWalletId],
      );

      // 2. Create transfer and wait for wallet debited event
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount: 5000,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // 3. Wait for debit to occur (outbox entry to be created)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 4. Verify wallet service created outbox entry for WalletDebited
      const outboxEntries = await walletDataSource.query(
        `SELECT * FROM outbox WHERE aggregate_id = $1`,
        [transferId],
      );

      // Should have at least WalletDebited entry
      const debitedEntry = outboxEntries.find(
        (e: { event_type: string }) => e.event_type === 'WalletDebited',
      );
      expect(debitedEntry).toBeDefined();
      expect(debitedEntry.aggregate_type).toBe('Wallet');
    });
  });

  describe('Outbox Publishing', () => {
    it('should publish outbox entries and mark them as published', async () => {
      // 1. Create wallets
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
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [10000, senderWalletId],
      );

      // 2. Create transfer
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount: 5000,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // 3. Wait for outbox entries to be published
      await waitForOutboxPublished(transactionDataSource, transferId);

      // 4. Verify all entries are marked as published
      const unpublishedEntries = await transactionDataSource.query(
        `SELECT * FROM outbox 
         WHERE aggregate_id = $1 AND published_at IS NULL`,
        [transferId],
      );
      expect(unpublishedEntries).toHaveLength(0);

      // 5. Verify published_at is set
      const publishedEntries = await transactionDataSource.query(
        `SELECT * FROM outbox 
         WHERE aggregate_id = $1 AND published_at IS NOT NULL`,
        [transferId],
      );
      expect(publishedEntries.length).toBeGreaterThanOrEqual(1);
    });

    it('should manually trigger outbox processing', async () => {
      // 1. Create wallets
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
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [10000, senderWalletId],
      );

      // 2. Create transfer
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount: 5000,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // 3. Manually trigger outbox processing
      await transactionOutboxPublisher.processOutbox();

      // 4. Verify transfer.initiated entry is published
      const publishedEntries = await transactionDataSource.query(
        `SELECT * FROM outbox 
         WHERE aggregate_id = $1 
         AND event_type = 'TransferInitiated' 
         AND published_at IS NOT NULL`,
        [transferId],
      );
      expect(publishedEntries).toHaveLength(1);
    });
  });

  describe('Full Saga via Outbox', () => {
    it('should complete transfer saga using outbox-based event publishing', async () => {
      // 1. Create wallets
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

      // 2. Seed sender balance
      const initialBalance = 10000;
      await walletDataSource.query(
        'UPDATE wallets SET balance = $1 WHERE wallet_id = $2',
        [initialBalance, senderWalletId],
      );

      // 3. Create transfer
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

      // 4. Wait for saga completion
      await waitForSagaCompletion(transferId, 'COMPLETED');

      // 5. Verify final transfer status
      const finalTransfer = await request(transactionApp.getHttpServer())
        .get(`/transfers/${transferId}`)
        .expect(200);
      expect(finalTransfer.body.status).toBe('COMPLETED');

      // 6. Verify balances
      const senderAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(senderAfter.body.balance).toBe(initialBalance - transferAmount);

      const receiverAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${receiverWalletId}`)
        .expect(200);
      expect(receiverAfter.body.balance).toBe(transferAmount);

      // 7. Verify outbox entries exist and are published in both services
      const transactionOutbox = await transactionDataSource.query(
        `SELECT event_type, published_at FROM outbox 
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [transferId],
      );
      expect(transactionOutbox.length).toBeGreaterThanOrEqual(2); // TransferInitiated, TransferCompleted
      expect(
        transactionOutbox.every(
          (e: { published_at: Date | null }) => e.published_at !== null,
        ),
      ).toBe(true);

      const walletOutbox = await walletDataSource.query(
        `SELECT event_type, published_at FROM outbox 
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [transferId],
      );
      expect(walletOutbox.length).toBeGreaterThanOrEqual(2); // WalletDebited, WalletCredited
      expect(
        walletOutbox.every(
          (e: { published_at: Date | null }) => e.published_at !== null,
        ),
      ).toBe(true);
    }, 30000);

    it('should handle compensation saga via outbox', async () => {
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

      // 2. Non-existent receiver to trigger compensation
      const nonExistentReceiverWalletId = uuidv7();

      // 3. Create transfer
      const transferAmount = 5000;
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId: nonExistentReceiverWalletId,
          amount: transferAmount,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // 4. Wait for saga to fail
      await waitForSagaCompletion(transferId, 'FAILED');

      // 5. Wait for refund to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 6. Verify sender balance restored
      const senderAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${senderWalletId}`)
        .expect(200);
      expect(senderAfter.body.balance).toBe(initialBalance);

      // 7. Verify wallet outbox has compensation events
      const walletOutbox = await walletDataSource.query(
        `SELECT event_type FROM outbox 
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [transferId],
      );
      const eventTypes = walletOutbox.map(
        (e: { event_type: string }) => e.event_type,
      );
      expect(eventTypes).toContain('WalletDebited');
      expect(eventTypes).toContain('WalletCreditFailed');
      expect(eventTypes).toContain('WalletRefunded');
    }, 30000);
  });

  describe('Outbox Atomicity', () => {
    it('should not leave orphaned outbox entries on failed operations', async () => {
      // Create wallets
      const senderUserId = uuidv7();
      const senderResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId: senderUserId })
        .expect(201);
      const senderWalletId = senderResponse.body.walletId as string;

      // Non-existent receiver
      const nonExistentReceiverWalletId = uuidv7();

      // Try to create a transfer (will eventually fail)
      const transferResponse = await request(transactionApp.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId: nonExistentReceiverWalletId,
          amount: 5000,
        })
        .expect(202);

      const transferId = transferResponse.body.transferId as string;

      // Wait for saga to complete
      await waitForSagaCompletion(transferId, 'FAILED');

      // Verify all outbox entries are published (no orphaned unpublished entries)
      await waitForOutboxPublished(transactionDataSource, transferId, 5000);
      await waitForOutboxPublished(walletDataSource, transferId, 5000);
    }, 30000);
  });
});
