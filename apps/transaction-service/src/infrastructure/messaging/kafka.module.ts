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
                initialRetryTime: 1000,
                retries: 10,
              },
            },
            producer: {
              allowAutoTopicCreation: true,
            },
          },
        }),
      },
    ]),
  ],
  providers: [KafkaProducerService] as const,
  exports: [KafkaProducerService] as const,
})
export class KafkaModule {}
