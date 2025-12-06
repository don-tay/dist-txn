import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
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

  // Note: Response serialization is handled explicitly via plainToInstance()
  // in service methods, which applies @Expose() and @Transform() decorators.
  // No ClassSerializerInterceptor needed.

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);
  await app.listen(port);

  logger.log(`Running on port ${String(port)}`);
}

void bootstrap();
