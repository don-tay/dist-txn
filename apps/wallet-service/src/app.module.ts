import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './interface/http/health.controller.js';
import { WalletController } from './interface/http/wallet.controller.js';
import { WalletService } from './application/services/wallet.service.js';
import { WalletOrmEntity } from './infrastructure/persistence/wallet.orm-entity.js';
import { WalletRepositoryImpl } from './infrastructure/persistence/wallet.repository.impl.js';
import { WALLET_REPOSITORY } from './domain/repositories/wallet.repository.js';

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
        entities: [WalletOrmEntity],
        synchronize: true, // Dev only - use migrations in production
      }),
    }),
    TypeOrmModule.forFeature([WalletOrmEntity]),
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
})
export class AppModule {}
