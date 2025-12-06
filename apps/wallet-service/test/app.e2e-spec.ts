import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { v7 as uuidv7 } from 'uuid';

describe('WalletService (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
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
  });

  afterEach(async () => {
    await app.close();
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
        .send({ user_id: userId })
        .expect(201);

      expect(response.body).toMatchObject({
        user_id: userId,
        balance: 0,
      });
      expect(response.body.wallet_id).toBeDefined();
      expect(response.body.created_at).toBeDefined();
    });

    it('should reject duplicate wallet for same user', async () => {
      const userId = uuidv7();

      // First wallet creation succeeds
      await request(app.getHttpServer())
        .post('/wallets')
        .send({ user_id: userId })
        .expect(201);

      // Second wallet creation for same user fails
      await request(app.getHttpServer())
        .post('/wallets')
        .send({ user_id: userId })
        .expect(409);
    });

    it('should reject invalid user_id', async () => {
      await request(app.getHttpServer())
        .post('/wallets')
        .send({ user_id: 'not-a-uuid' })
        .expect(400);
    });

    it('should reject missing user_id', async () => {
      await request(app.getHttpServer()).post('/wallets').send({}).expect(400);
    });

    it('should reject extra properties', async () => {
      const userId = uuidv7();

      const response = await request(app.getHttpServer())
        .post('/wallets')
        .send({ user_id: userId, extra_field: 'not allowed' })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('extra_field')]),
      );
    });
  });

  describe('/wallets/:wallet_id (GET)', () => {
    it('should retrieve an existing wallet', async () => {
      const userId = uuidv7();

      // Create wallet first
      const createResponse = await request(app.getHttpServer())
        .post('/wallets')
        .send({ user_id: userId })
        .expect(201);

      const walletId = createResponse.body.wallet_id as string;

      // Retrieve wallet
      const response = await request(app.getHttpServer())
        .get(`/wallets/${walletId}`)
        .expect(200);

      expect(response.body).toMatchObject({
        wallet_id: walletId,
        user_id: userId,
        balance: 0,
      });
      expect(response.body.created_at).toBeDefined();
      expect(response.body.updated_at).toBeDefined();
    });

    it('should return 404 for non-existent wallet', async () => {
      const nonExistentId = uuidv7();

      await request(app.getHttpServer())
        .get(`/wallets/${nonExistentId}`)
        .expect(404);
    });

    it('should return 400 for invalid wallet_id format', async () => {
      await request(app.getHttpServer()).get('/wallets/not-a-uuid').expect(400);
    });
  });
});
