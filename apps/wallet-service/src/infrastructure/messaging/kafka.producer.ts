import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, logLevel, Partitioners } from 'kafkajs';
import {
  KAFKA_TOPICS,
  WalletDebitedEvent,
  WalletDebitFailedEvent,
  WalletCreditedEvent,
  WalletCreditFailedEvent,
  WalletRefundedEvent,
} from '@app/common';

@Injectable()
export class KafkaProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducer.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;

  constructor(private readonly configService: ConfigService) {
    this.kafka = new Kafka({
      clientId: 'wallet-service',
      brokers: [
        this.configService.get<string>('KAFKA_BROKER', 'localhost:9092'),
      ],
      logLevel: logLevel.WARN,
      retry: {
        initialRetryTime: 1000,
        retries: 10,
      },
    });
    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }

  async publishWalletDebited(event: WalletDebitedEvent): Promise<void> {
    await this.producer.send({
      topic: KAFKA_TOPICS.WALLET_DEBITED,
      messages: [{ key: event.transferId, value: JSON.stringify(event) }],
    });
  }

  async publishWalletDebitFailed(event: WalletDebitFailedEvent): Promise<void> {
    await this.producer.send({
      topic: KAFKA_TOPICS.WALLET_DEBIT_FAILED,
      messages: [{ key: event.transferId, value: JSON.stringify(event) }],
    });
  }

  async publishWalletCredited(event: WalletCreditedEvent): Promise<void> {
    await this.producer.send({
      topic: KAFKA_TOPICS.WALLET_CREDITED,
      messages: [{ key: event.transferId, value: JSON.stringify(event) }],
    });
  }

  async publishWalletCreditFailed(
    event: WalletCreditFailedEvent,
  ): Promise<void> {
    await this.producer.send({
      topic: KAFKA_TOPICS.WALLET_CREDIT_FAILED,
      messages: [{ key: event.transferId, value: JSON.stringify(event) }],
    });
  }

  async publishWalletRefunded(event: WalletRefundedEvent): Promise<void> {
    await this.producer.send({
      topic: KAFKA_TOPICS.WALLET_REFUNDED,
      messages: [{ key: event.transferId, value: JSON.stringify(event) }],
    });
  }
}
