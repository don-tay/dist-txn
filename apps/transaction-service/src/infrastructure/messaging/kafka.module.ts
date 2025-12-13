import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KAFKA_CLIENT } from './kafka.constants';
import { KafkaProducerService } from './kafka.producer.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: KAFKA_CLIENT,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: 'transaction-service',
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
              sessionTimeout: 6000,
              heartbeatInterval: 100,
              rebalanceTimeout: 5000,
              groupId: 'transaction-service-client',
            },
            producer: {
              allowAutoTopicCreation: true,
            },
          },
        }),
      },
    ]),
  ],
  providers: [KafkaProducerService],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
