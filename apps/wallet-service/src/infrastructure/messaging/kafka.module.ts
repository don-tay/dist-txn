import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KAFKA_CLIENT } from './kafka.constants';
import { KafkaProducerService } from './kafka.producer.service';
import { DlqService } from './dlq.service';
import { DEAD_LETTER_REPOSITORY } from '../../domain/repositories/dead-letter.repository';
import { DeadLetterRepositoryImpl } from '../persistence/dead-letter.repository.impl';
import { DeadLetterOrmEntity } from '../persistence/dead-letter.orm-entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeadLetterOrmEntity]),
    ClientsModule.registerAsync([
      {
        name: KAFKA_CLIENT,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: 'wallet-service',
              brokers: [
                configService.get<string>('KAFKA_BROKER', 'localhost:9092'),
              ],
              retry: {
                initialRetryTime: 100,
                retries: 5,
              },
              connectionTimeout: 1000,
            },
            consumer: {
              // Faster rebalancing for the internal request-reply consumer
              sessionTimeout: 2000,
              heartbeatInterval: 1000,
              rebalanceTimeout: 2000,
              groupId: 'wallet-service-client',
            },
            producer: {
              allowAutoTopicCreation: true,
            },
          },
        }),
      },
    ]),
  ],
  providers: [
    KafkaProducerService,
    DlqService,
    {
      provide: DEAD_LETTER_REPOSITORY,
      useClass: DeadLetterRepositoryImpl,
    },
  ],
  exports: [KafkaProducerService, DlqService],
})
export class KafkaModule {}
