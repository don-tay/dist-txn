import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { AppModule } from '../src/app.module';

/**
 * Wallet Service E2E Tests (HTTP API only)
 *
 * These tests verify the HTTP API layer in isolation.
 *
 * WHAT'S TESTED HERE:
 * - POST /wallets - Creates wallet with zero balance
 * - GET /wallets/:id - Retrieves wallet by ID
 * - GET /health - Health check endpoint
 * - Input validation (UUIDs, required fields, extra properties)
 * - Duplicate wallet rejection (409 Conflict)
 *
 * WHAT'S NOT TESTED HERE:
 * - Wallet debit/credit operations (triggered via Kafka events)
 * - Ledger entry creation
 * - Saga state transitions
 * - Cross-service communication
 */
describe('WalletService (e2e)', () => {
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
    await dataSource.query(
      'TRUNCATE TABLE dead_letter_queue, wallet_ledger_entries, wallets, outbox CASCADE',
    );
  });

  describe('/health (GET)', () => {
    it('should return health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
    });
  });

  describe('/wallets (POST)', () => {
    it('should create a wallet with zero balance', async () => {
      const userId = uuidv7();

      const response = await request(app.getHttpServer())
        .post('/wallets')
        .send({ userId })
        .expect(201);

      expect(response.body).toMatchObject({
        userId,
        balance: 0,
      });
      expect(response.body.walletId).toBeDefined();
      expect(response.body.createdAt).toBeDefined();
    });

    it('should reject duplicate wallet for same user', async () => {
      const userId = uuidv7();

      // First wallet creation succeeds
      await request(app.getHttpServer())
        .post('/wallets')
        .send({ userId })
        .expect(201);

      // Second wallet creation for same user fails
      await request(app.getHttpServer())
        .post('/wallets')
        .send({ userId })
        .expect(409);
    });

    it('should reject invalid userId', async () => {
      await request(app.getHttpServer())
        .post('/wallets')
        .send({ userId: 'not-a-uuid' })
        .expect(400);
    });

    it('should reject missing userId', async () => {
      await request(app.getHttpServer()).post('/wallets').send({}).expect(400);
    });

    it('should reject extra properties', async () => {
      const userId = uuidv7();

      const response = await request(app.getHttpServer())
        .post('/wallets')
        .send({ userId, extraField: 'not allowed' })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('extraField')]),
      );
    });
  });

  describe('/wallets/:walletId (GET)', () => {
    it('should retrieve an existing wallet', async () => {
      const userId = uuidv7();

      // Create wallet first
      const createResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({ userId })
        .expect(201);

      const walletId = createResponse.body.walletId as string;

      // Retrieve wallet
      const response = await request(app.getHttpServer())
        .get(`/wallets/${walletId}`)
        .expect(200);

      expect(response.body).toMatchObject({
        walletId,
        userId,
        balance: 0,
      });
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
    });

    it('should return 404 for non-existent wallet', async () => {
      const nonExistentId = uuidv7();

      await request(app.getHttpServer())
        .get(`/wallets/${nonExistentId}`)
        .expect(404);
    });

    it('should return 400 for invalid walletId format', async () => {
      await request(app.getHttpServer()).get('/wallets/not-a-uuid').expect(400);
    });
  });
});
