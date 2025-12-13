import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './interface/http/health.controller';
import { WalletController } from './interface/http/wallet.controller';
import { WalletService } from './application/services/wallet.service';
import { WalletOrmEntity } from './infrastructure/persistence/wallet.orm-entity';
import { WalletLedgerEntryOrmEntity } from './infrastructure/persistence/wallet-ledger-entry.orm-entity';
import { DeadLetterOrmEntity } from './infrastructure/persistence/dead-letter.orm-entity';
import { WalletRepositoryImpl } from './infrastructure/persistence/wallet.repository.impl';
import { WALLET_REPOSITORY } from './domain/repositories/wallet.repository';
import { KafkaModule } from './infrastructure/messaging/kafka.module';
import { KafkaEventHandler } from './infrastructure/messaging/kafka.event-handler';
import { DlqController } from './interface/http/dlq.controller';
import { DlqService } from './infrastructure/messaging/dlq.service';
import { DEAD_LETTER_REPOSITORY } from './domain/repositories/dead-letter.repository';
import { DeadLetterRepositoryImpl } from './infrastructure/persistence/dead-letter.repository.impl';

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
        host: configService.get<string>('WALLET_DB_HOST', 'localhost'),
        port: configService.get<number>('WALLET_DB_PORT', 5432),
        username: configService.get<string>('WALLET_DB_USER', 'wallet_user'),
        password: configService.get<string>(
          'WALLET_DB_PASSWORD',
          'wallet_pass',
        ),
        database: configService.get<string>('WALLET_DB_NAME', 'wallet_db'),
        entities: [
          WalletOrmEntity,
          WalletLedgerEntryOrmEntity,
          DeadLetterOrmEntity,
        ],
        synchronize: configService.get<boolean>('WALLET_DB_SYNCHRONIZE', false),
      }),
    }),
    TypeOrmModule.forFeature([
      WalletOrmEntity,
      WalletLedgerEntryOrmEntity,
      DeadLetterOrmEntity,
    ]),
    TerminusModule,
    KafkaModule,
  ],
  controllers: [
    HealthController,
    WalletController,
    DlqController,
    KafkaEventHandler,
  ],
  providers: [
    WalletService,
    {
      provide: WALLET_REPOSITORY,
      useClass: WalletRepositoryImpl,
    },
    DlqService,
    {
      provide: DEAD_LETTER_REPOSITORY,
      useClass: DeadLetterRepositoryImpl,
    },
  ],
})
export class AppModule {}
