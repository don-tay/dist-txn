import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

const logger = new Logger('WalletService');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Request validation (input): Validates incoming JSON against DTO decorators
  // - whitelist: strips properties without decorators
  // - forbidNonWhitelisted: rejects requests with extra properties
  // - transform: auto-converts JSON to DTO class instances
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const configService = app.get(ConfigService);
  const kafkaBroker = configService.get<string>(
    'KAFKA_BROKER',
    'localhost:9092',
  );

  // Connect Kafka microservice for consuming events
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.KAFKA,
    options: {
      client: {
        clientId: 'wallet-service-consumer',
        brokers: [kafkaBroker],
        retry: {
          initialRetryTime: 1000,
          retries: 10,
        },
      },
      consumer: {
        groupId: 'wallet-service-group',
      },
    },
  });

  // Start all microservices first
  await app.startAllMicroservices();
  logger.log('Kafka consumer microservice started');

  // Then start HTTP server
  const port = configService.get<number>('PORT', 3001);
  await app.listen(port);

  logger.log(`Running on port ${String(port)}`);
}

void bootstrap();
