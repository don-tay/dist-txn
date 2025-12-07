import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { jest } from '@jest/globals';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from '../src/interface/http/health.controller';
import { TransferController } from '../src/interface/http/transfer.controller';
import { TransferService } from '../src/application/services/transfer.service';
import { TransferOrmEntity } from '../src/infrastructure/persistence/transfer.orm-entity';
import { TransferRepositoryImpl } from '../src/infrastructure/persistence/transfer.repository.impl';
import { TRANSFER_REPOSITORY } from '../src/domain/repositories/transfer.repository';
import { KafkaProducerService } from '../src/infrastructure/messaging/kafka.producer.service';

/**
 * Transaction Service E2E Tests (HTTP API only)
 *
 * These tests verify the HTTP API layer in isolation, without requiring Kafka infrastructure.
 *
 * WHY WE MOCK KAFKA:
 * ------------------
 * 1. **Isolation**: These tests focus solely on HTTP request/response behavior (validation,
 *    status codes, response shapes). They don't test the async saga flow.
 *
 * 2. **Speed & Reliability**: Kafka connection during app initialization can take 5-30+ seconds
 *    and may fail intermittently. Mocking eliminates this external dependency.
 *
 * 3. **CI Simplicity**: HTTP-only tests can run with just PostgreSQL, without requiring
 *    Kafka + Zookeeper infrastructure.
 *
 * 4. **Separation of Concerns**: Full Kafka integration is tested separately in
 *    `test/saga.e2e-spec.ts` which spins up both services with real Kafka.
 *
 * WHAT'S TESTED HERE:
 * - POST /transfers - Creates transfer, validates input, returns 202 with PENDING status
 * - GET /transfers/:id - Retrieves transfer by ID
 * - GET /health - Health check endpoint
 * - Input validation (UUIDs, amounts, required fields, extra properties)
 *
 * WHAT'S NOT TESTED HERE:
 * - Kafka event publishing (verified via mock assertion, not actual delivery)
 * - Saga state transitions (PENDING -> DEBITED -> COMPLETED/FAILED)
 * - Cross-service communication
 */
describe('TransactionService (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  /**
   * Mock Kafka producer to avoid actual Kafka connection.
   * We still verify these methods are called with correct arguments
   * to ensure the service layer integrates properly.
   */
  const mockKafkaProducer = {
    publishTransferInitiated: jest.fn(),
    publishTransferCompleted: jest.fn(),
    publishTransferFailed: jest.fn(),
  };

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
            host: configService.get<string>('TRANSACTION_DB_HOST', 'localhost'),
            port: configService.get<number>('TRANSACTION_DB_PORT', 5432),
            username: configService.get<string>(
              'TRANSACTION_DB_USER',
              'transaction_user',
            ),
            password: configService.get<string>(
              'TRANSACTION_DB_PASSWORD',
              'transaction_pass',
            ),
            database: configService.get<string>(
              'TRANSACTION_DB_NAME',
              'transaction_db',
            ),
            entities: [TransferOrmEntity],
            synchronize: true,
          }),
        }),
        TypeOrmModule.forFeature([TransferOrmEntity]),
        TerminusModule,
      ],
      controllers: [HealthController, TransferController],
      providers: [
        TransferService,
        {
          provide: TRANSFER_REPOSITORY,
          useClass: TransferRepositoryImpl,
        },
        {
          provide: KafkaProducerService,
          useValue: mockKafkaProducer,
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
    await dataSource.query('TRUNCATE TABLE transfers CASCADE');
    jest.clearAllMocks();
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

      // Verify Kafka event was published
      expect(mockKafkaProducer.publishTransferInitiated).toHaveBeenCalledWith(
        expect.objectContaining({
          transferId: response.body.transferId,
          senderWalletId,
          receiverWalletId,
          amount,
        }),
      );
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
