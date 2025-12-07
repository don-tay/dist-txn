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
  TransferInitiatedEvent,
  TransferCompletedEvent,
  TransferFailedEvent,
} from '@app/common';

@Injectable()
export class KafkaProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducer.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;

  constructor(private readonly configService: ConfigService) {
    this.kafka = new Kafka({
      clientId: 'transaction-service',
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

  async publishTransferInitiated(event: TransferInitiatedEvent): Promise<void> {
    await this.producer.send({
      topic: KAFKA_TOPICS.TRANSFER_INITIATED,
      messages: [{ key: event.transferId, value: JSON.stringify(event) }],
    });
  }

  async publishTransferCompleted(event: TransferCompletedEvent): Promise<void> {
    await this.producer.send({
      topic: KAFKA_TOPICS.TRANSFER_COMPLETED,
      messages: [{ key: event.transferId, value: JSON.stringify(event) }],
    });
  }

  async publishTransferFailed(event: TransferFailedEvent): Promise<void> {
    await this.producer.send({
      topic: KAFKA_TOPICS.TRANSFER_FAILED,
      messages: [{ key: event.transferId, value: JSON.stringify(event) }],
    });
  }
}
