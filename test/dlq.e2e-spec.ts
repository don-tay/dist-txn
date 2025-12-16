import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AppModule as WalletAppModule } from '../apps/wallet-service/src/app.module';
import { DeadLetterStatus } from '../apps/wallet-service/src/domain/entities/dead-letter.entity';

/**
 * DLQ (Dead Letter Queue) E2E Tests
 *
 * Tests the DLQ admin API and replay functionality.
 * Uses direct database manipulation to create reliable test scenarios.
 *
 * Prerequisites:
 * - PostgreSQL running with wallet_db database
 * - Kafka running on localhost:9092
 *
 * Run with: npm run test:e2e:dlq
 */
describe('Dead Letter Queue (e2e)', () => {
  let walletApp: INestApplication;
  let walletDataSource: DataSource;
  const logger = new Logger('DlqE2ETest');

  // Use unique consumer groups per test run to avoid cross-test contamination
  const testRunId = Date.now().toString(36);
  const walletConsumerGroup = `wallet-service-group-dlq-${testRunId}`;

  beforeAll(async () => {
    const kafkaBroker = process.env['KAFKA_BROKER'] ?? 'localhost:9092';

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
          clientId: 'wallet-service-consumer-dlq',
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

    logger.debug('Wallet service initialized for DLQ tests');
  }, 60000);

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await walletApp.close();
  }, 30000);

  beforeEach(async () => {
    // Clean up tables before each test
    await walletDataSource.query(
      'TRUNCATE TABLE dead_letter_queue, wallet_ledger_entries, wallets CASCADE',
    );
  });

  describe('DLQ Admin API', () => {
    it('should list empty DLQ entries when no failures exist', async () => {
      const response = await request(walletApp.getHttpServer())
        .get('/admin/dlq')
        .expect(200);

      expect(response.body).toBeInstanceOf(Array);
      expect(response.body.length).toBe(0);
    });

    it('should list DLQ entries filtered by status', async () => {
      // Insert test DLQ entries directly
      const pendingId = uuidv7();
      const processedId = uuidv7();

      await walletDataSource.query(
        `INSERT INTO dead_letter_queue 
         (id, original_topic, original_payload, error_message, error_stack, 
          attempt_count, status, created_at)
         VALUES 
         ($1, 'wallet.credit-failed', '{"transferId": "test1"}', 'Test error', NULL, 3, 'PENDING', NOW()),
         ($2, 'wallet.credit-failed', '{"transferId": "test2"}', 'Test error', NULL, 3, 'PROCESSED', NOW())`,
        [pendingId, processedId],
      );

      // Get all entries
      const allResponse = await request(walletApp.getHttpServer())
        .get('/admin/dlq')
        .expect(200);
      expect(allResponse.body.length).toBe(2);

      // Get pending entries only
      const pendingResponse = await request(walletApp.getHttpServer())
        .get('/admin/dlq?status=PENDING')
        .expect(200);
      expect(pendingResponse.body.length).toBe(1);
      expect(pendingResponse.body[0].id).toBe(pendingId);

      // Get processed entries only
      const processedResponse = await request(walletApp.getHttpServer())
        .get('/admin/dlq?status=PROCESSED')
        .expect(200);
      expect(processedResponse.body.length).toBe(1);
      expect(processedResponse.body[0].id).toBe(processedId);
    });

    it('should get a specific DLQ entry by ID', async () => {
      const dlqId = uuidv7();
      const transferId = uuidv7();

      await walletDataSource.query(
        `INSERT INTO dead_letter_queue 
         (id, original_topic, original_payload, error_message, error_stack, 
          attempt_count, status, created_at)
         VALUES ($1, 'wallet.credit-failed', $2, 'Wallet not found', 'Error stack', 3, 'PENDING', NOW())`,
        [
          dlqId,
          JSON.stringify({
            transferId,
            senderWalletId: uuidv7(),
            amount: 5000,
          }),
        ],
      );

      const response = await request(walletApp.getHttpServer())
        .get(`/admin/dlq/${dlqId}`)
        .expect(200);

      expect(response.body.id).toBe(dlqId);
      expect(response.body.originalTopic).toBe('wallet.credit-failed');
      expect(response.body.errorMessage).toBe('Wallet not found');
      expect(response.body.attemptCount).toBe(3);
      expect(response.body.status).toBe('PENDING');
    });

    it('should return 404 for non-existent DLQ entry', async () => {
      const nonExistentId = uuidv7();

      await request(walletApp.getHttpServer())
        .get(`/admin/dlq/${nonExistentId}`)
        .expect(404);
    });
  });

  describe('DLQ Replay', () => {
    it('should successfully replay a DLQ entry when wallet exists', async () => {
      // 1. Create wallet
      const userId = uuidv7();
      const walletResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId })
        .expect(201);
      const walletId = walletResponse.body.walletId as string;

      // 2. Create DLQ entry for a failed refund
      const dlqId = uuidv7();
      const transferId = uuidv7();
      const refundAmount = 5000;

      await walletDataSource.query(
        `INSERT INTO dead_letter_queue 
         (id, original_topic, original_payload, error_message, error_stack, 
          attempt_count, status, created_at)
         VALUES ($1, 'wallet.credit-failed', $2, 'Wallet not found', NULL, 3, 'PENDING', NOW())`,
        [
          dlqId,
          JSON.stringify({
            transferId,
            walletId: uuidv7(), // Original receiver
            reason: 'Wallet not found',
            senderWalletId: walletId, // Sender to refund
            amount: refundAmount,
            timestamp: new Date().toISOString(),
          }),
        ],
      );

      // 3. Verify initial wallet balance is 0
      const walletBefore = await request(walletApp.getHttpServer())
        .get(`/wallets/${walletId}`)
        .expect(200);
      expect(walletBefore.body.balance).toBe(0);

      // 4. Replay the DLQ entry
      const replayResponse = await request(walletApp.getHttpServer())
        .post(`/admin/dlq/${dlqId}/replay`)
        .expect(200);

      expect(replayResponse.body.success).toBe(true);

      // 5. Verify wallet balance was refunded
      const walletAfter = await request(walletApp.getHttpServer())
        .get(`/wallets/${walletId}`)
        .expect(200);
      expect(walletAfter.body.balance).toBe(refundAmount);

      // 6. Verify DLQ entry is marked as processed
      const dlqAfter = await walletDataSource.query(
        'SELECT status, processed_at FROM dead_letter_queue WHERE id = $1',
        [dlqId],
      );
      expect(dlqAfter[0].status).toBe(DeadLetterStatus.PROCESSED);
      expect(dlqAfter[0].processed_at).not.toBeNull();
    });

    it('should fail replay when wallet does not exist', async () => {
      // Create DLQ entry for non-existent wallet
      const dlqId = uuidv7();
      const nonExistentWalletId = uuidv7();

      await walletDataSource.query(
        `INSERT INTO dead_letter_queue 
         (id, original_topic, original_payload, error_message, error_stack, 
          attempt_count, status, created_at)
         VALUES ($1, 'wallet.credit-failed', $2, 'Wallet not found', NULL, 3, 'PENDING', NOW())`,
        [
          dlqId,
          JSON.stringify({
            transferId: uuidv7(),
            walletId: uuidv7(),
            reason: 'Wallet not found',
            senderWalletId: nonExistentWalletId,
            amount: 5000,
            timestamp: new Date().toISOString(),
          }),
        ],
      );

      // Replay should fail
      const replayResponse = await request(walletApp.getHttpServer())
        .post(`/admin/dlq/${dlqId}/replay`)
        .expect(200);

      expect(replayResponse.body.success).toBe(false);
      expect(replayResponse.body.message).toContain('Wallet not found');

      // DLQ entry should be marked as FAILED
      const dlqAfter = await walletDataSource.query(
        'SELECT status FROM dead_letter_queue WHERE id = $1',
        [dlqId],
      );
      expect(dlqAfter[0].status).toBe(DeadLetterStatus.FAILED);
    });

    it('should handle idempotent replay (no double refund)', async () => {
      // 1. Create wallet
      const userId = uuidv7();
      const walletResponse = await request(walletApp.getHttpServer())
        .post('/wallets')
        .send({ userId })
        .expect(201);
      const walletId = walletResponse.body.walletId as string;

      // 2. Create DLQ entry
      const dlqId = uuidv7();
      const transferId = uuidv7();
      const refundAmount = 5000;

      await walletDataSource.query(
        `INSERT INTO dead_letter_queue 
         (id, original_topic, original_payload, error_message, error_stack, 
          attempt_count, status, created_at)
         VALUES ($1, 'wallet.credit-failed', $2, 'Wallet not found', NULL, 3, 'PENDING', NOW())`,
        [
          dlqId,
          JSON.stringify({
            transferId,
            walletId: uuidv7(),
            reason: 'Wallet not found',
            senderWalletId: walletId,
            amount: refundAmount,
            timestamp: new Date().toISOString(),
          }),
        ],
      );

      // 3. First replay - should succeed and refund
      await request(walletApp.getHttpServer())
        .post(`/admin/dlq/${dlqId}/replay`)
        .expect(200);

      const walletAfterFirst = await request(walletApp.getHttpServer())
        .get(`/wallets/${walletId}`)
        .expect(200);
      expect(walletAfterFirst.body.balance).toBe(refundAmount);

      // 4. Reset DLQ status to PENDING (simulate re-queuing)
      await walletDataSource.query(
        "UPDATE dead_letter_queue SET status = 'PENDING', processed_at = NULL WHERE id = $1",
        [dlqId],
      );

      // 5. Second replay - should be idempotent (no double refund)
      const secondReplay = await request(walletApp.getHttpServer())
        .post(`/admin/dlq/${dlqId}/replay`)
        .expect(200);

      // The ledger entry already exists, so this is a no-op
      expect(secondReplay.body.success).toBe(true);

      // Balance should still be the same (not doubled)
      const walletAfterSecond = await request(walletApp.getHttpServer())
        .get(`/wallets/${walletId}`)
        .expect(200);
      expect(walletAfterSecond.body.balance).toBe(refundAmount);
    });
  });
});
