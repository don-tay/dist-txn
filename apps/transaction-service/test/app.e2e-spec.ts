import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AppModule } from '../src/app.module';

/**
 * Transaction Service E2E Tests (HTTP API only)
 *
 * These tests verify the HTTP API layer using the actual AppModule,
 * ensuring the test environment mirrors runtime behavior as closely as possible.
 *
 * OUTBOX PATTERN:
 * ---------------
 * With the outbox pattern, TransferService no longer publishes directly to Kafka.
 * Instead, it writes events to the outbox table atomically with domain changes.
 * These tests verify outbox entries are created correctly.
 *
 * WHAT'S TESTED HERE:
 * - POST /transfers - Creates transfer, validates input, returns 202 with PENDING status
 * - POST /transfers - Verifies outbox entry created atomically
 * - GET /transfers/:id - Retrieves transfer by ID
 * - GET /health - Health check endpoint
 * - Input validation (UUIDs, amounts, required fields, extra properties)
 *
 * WHAT'S NOT TESTED HERE:
 * - Kafka event publishing (handled by OutboxPublisherService, tested in outbox.e2e-spec.ts)
 * - Saga state transitions (PENDING -> DEBITED -> COMPLETED/FAILED)
 * - Cross-service communication
 */
describe('TransactionService (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    dataSource = app.get(DataSource);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean tables before each test
    await dataSource.query('TRUNCATE TABLE transfers, outbox CASCADE');
  });

  describe('/health (GET)', () => {
    it('should return health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
    });
  });

  describe('/transfers (POST)', () => {
    it('should create a transfer with PENDING status', async () => {
      const senderWalletId = uuidv7();
      const receiverWalletId = uuidv7();
      const amount = 5000;

      const response = await request(app.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount,
        })
        .expect(202);

      expect(response.body).toMatchObject({
        senderWalletId,
        receiverWalletId,
        amount,
        status: 'PENDING',
      });
      expect(response.body.transferId).toBeDefined();
      expect(response.body.createdAt).toBeDefined();

      // Verify outbox entry was created atomically with the transfer
      const outboxEntries = await dataSource.query(
        `SELECT * FROM outbox WHERE aggregate_id = $1`,
        [response.body.transferId],
      );
      expect(outboxEntries).toHaveLength(1);
      expect(outboxEntries[0].event_type).toBe('TransferInitiated');
      expect(outboxEntries[0].aggregate_type).toBe('Transfer');
      // payload is stored as jsonb, returned as object by pg driver
      expect(outboxEntries[0].payload).toMatchObject({
        transferId: response.body.transferId,
        senderWalletId,
        receiverWalletId,
        amount,
      });
    });

    it('should reject transfer to same wallet', async () => {
      const walletId = uuidv7();

      await request(app.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId: walletId,
          receiverWalletId: walletId,
          amount: 5000,
        })
        .expect(400);
    });

    it('should reject zero amount', async () => {
      const senderWalletId = uuidv7();
      const receiverWalletId = uuidv7();

      await request(app.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount: 0,
        })
        .expect(400);
    });

    it('should reject negative amount', async () => {
      const senderWalletId = uuidv7();
      const receiverWalletId = uuidv7();

      await request(app.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount: -100,
        })
        .expect(400);
    });

    it('should reject invalid senderWalletId', async () => {
      await request(app.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId: 'not-a-uuid',
          receiverWalletId: uuidv7(),
          amount: 5000,
        })
        .expect(400);
    });

    it('should reject invalid receiverWalletId', async () => {
      await request(app.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId: uuidv7(),
          receiverWalletId: 'not-a-uuid',
          amount: 5000,
        })
        .expect(400);
    });

    it('should reject missing required fields', async () => {
      await request(app.getHttpServer())
        .post('/transfers')
        .send({})
        .expect(400);
    });

    it('should reject extra properties', async () => {
      const response = await request(app.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId: uuidv7(),
          receiverWalletId: uuidv7(),
          amount: 5000,
          extraField: 'not allowed',
        })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('extraField')]),
      );
    });
  });

  describe('/transfers/:transferId (GET)', () => {
    it('should retrieve an existing transfer', async () => {
      const senderWalletId = uuidv7();
      const receiverWalletId = uuidv7();
      const amount = 5000;

      // Create transfer first
      const createResponse = await request(app.getHttpServer())
        .post('/transfers')
        .send({
          senderWalletId,
          receiverWalletId,
          amount,
        })
        .expect(202);

      const transferId = createResponse.body.transferId as string;

      // Retrieve transfer
      const response = await request(app.getHttpServer())
        .get(`/transfers/${transferId}`)
        .expect(200);

      expect(response.body).toMatchObject({
        transferId,
        senderWalletId,
        receiverWalletId,
        amount,
        status: 'PENDING',
        failureReason: null,
      });
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
    });

    it('should return 404 for non-existent transfer', async () => {
      const nonExistentId = uuidv7();

      await request(app.getHttpServer())
        .get(`/transfers/${nonExistentId}`)
        .expect(404);
    });

    it('should return 400 for invalid transferId format', async () => {
      await request(app.getHttpServer())
        .get('/transfers/not-a-uuid')
        .expect(400);
    });
  });
});
