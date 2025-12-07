import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from '../src/interface/http/health.controller';
import { WalletController } from '../src/interface/http/wallet.controller';
import { WalletService } from '../src/application/services/wallet.service';
import { WalletOrmEntity } from '../src/infrastructure/persistence/wallet.orm-entity';
import { WalletLedgerEntryOrmEntity } from '../src/infrastructure/persistence/wallet-ledger-entry.orm-entity';
import { WalletRepositoryImpl } from '../src/infrastructure/persistence/wallet.repository.impl';
import { WALLET_REPOSITORY } from '../src/domain/repositories/wallet.repository';

/**
 * Wallet Service E2E Tests (HTTP API only)
 *
 * These tests verify the HTTP API layer in isolation, without requiring Kafka infrastructure.
 *
 * WHY WE EXCLUDE KAFKA:
 * ---------------------
 * 1. **Isolation**: These tests focus solely on HTTP request/response behavior (validation,
 *    status codes, response shapes). They don't test the async saga flow.
 *
 * 2. **Speed & Reliability**: Kafka connection during app initialization can take 5-30+ seconds
 *    and may fail intermittently. Excluding it eliminates this external dependency.
 *
 * 3. **CI Simplicity**: HTTP-only tests can run with just PostgreSQL, without requiring
 *    Kafka + Zookeeper infrastructure.
 *
 * 4. **Separation of Concerns**: Full Kafka integration is tested separately in
 *    `test/saga.e2e-spec.ts` which spins up both services with real Kafka.
 *
 * 5. **No Producer Dependency**: Unlike TransactionService, WalletController doesn't call
 *    KafkaProducerService directly - only KafkaEventHandler does (which handles incoming
 *    Kafka events, not HTTP requests).
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
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['.env.local', '.env'],
        }),
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (configService: ConfigService) => ({
            type: 'postgres',
            host: configService.get<string>('WALLET_DB_HOST', 'localhost'),
            port: configService.get<number>('WALLET_DB_PORT', 5432),
            username: configService.get<string>(
              'WALLET_DB_USER',
              'wallet_user',
            ),
            password: configService.get<string>(
              'WALLET_DB_PASSWORD',
              'wallet_pass',
            ),
            database: configService.get<string>('WALLET_DB_NAME', 'wallet_db'),
            entities: [WalletOrmEntity, WalletLedgerEntryOrmEntity],
            synchronize: true,
          }),
        }),
        TypeOrmModule.forFeature([WalletOrmEntity, WalletLedgerEntryOrmEntity]),
        TerminusModule,
      ],
      controllers: [HealthController, WalletController],
      providers: [
        WalletService,
        {
          provide: WALLET_REPOSITORY,
          useClass: WalletRepositoryImpl,
        },
      ],
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
      'TRUNCATE TABLE wallet_ledger_entries, wallets CASCADE',
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
