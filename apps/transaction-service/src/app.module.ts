import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminusModule } from '@nestjs/terminus';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './interface/http/health.controller';
import { TransferController } from './interface/http/transfer.controller';
import { TransferService } from './application/services/transfer.service';
import { SagaTimeoutService } from './application/services/saga-timeout.service';
import { OutboxPublisherService } from './application/services/outbox-publisher.service';
import { TransferOrmEntity } from './infrastructure/persistence/transfer.orm-entity';
import { OutboxOrmEntity } from './infrastructure/persistence/outbox.orm-entity';
import { TransferRepositoryImpl } from './infrastructure/persistence/transfer.repository.impl';
import { OutboxRepositoryImpl } from './infrastructure/persistence/outbox.repository.impl';
import { TRANSFER_REPOSITORY } from './domain/repositories/transfer.repository';
import { OUTBOX_REPOSITORY } from './domain/repositories/outbox.repository';
import { KafkaModule } from './infrastructure/messaging/kafka.module';
import { KafkaEventHandler } from './infrastructure/messaging/kafka.event-handler';

@Module({
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
        entities: [TransferOrmEntity, OutboxOrmEntity],
        synchronize: configService.get<boolean>(
          'TRANSACTION_DB_SYNCHRONIZE',
          false,
        ),
      }),
    }),
    TypeOrmModule.forFeature([TransferOrmEntity, OutboxOrmEntity]),
    TerminusModule,
    ScheduleModule.forRoot(),
    KafkaModule,
  ],
  controllers: [HealthController, TransferController, KafkaEventHandler],
  providers: [
    TransferService,
    SagaTimeoutService,
    OutboxPublisherService,
    {
      provide: TRANSFER_REPOSITORY,
      useClass: TransferRepositoryImpl,
    },
    {
      provide: OUTBOX_REPOSITORY,
      useClass: OutboxRepositoryImpl,
    },
  ],
})
export class AppModule {}
