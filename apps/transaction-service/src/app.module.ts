import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './interface/http/health.controller';
import { TransferController } from './interface/http/transfer.controller';
import { TransferService } from './application/services/transfer.service';
import { TransferOrmEntity } from './infrastructure/persistence/transfer.orm-entity';
import { TransferRepositoryImpl } from './infrastructure/persistence/transfer.repository.impl';
import { TRANSFER_REPOSITORY } from './domain/repositories/transfer.repository';
import { KafkaProducer } from './infrastructure/messaging/kafka.producer';
import { KafkaConsumer } from './infrastructure/messaging/kafka.consumer';

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
        entities: [TransferOrmEntity],
        synchronize: configService.get<boolean>(
          'TRANSACTION_DB_SYNCHRONIZE',
          false,
        ),
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
    KafkaProducer,
    KafkaConsumer,
  ],
})
export class AppModule {}
