import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import {
  KAFKA_TOPICS,
  type TransferInitiatedEvent,
  type TransferCompletedEvent,
  type TransferFailedEvent,
} from '@app/common';
import { KAFKA_CLIENT } from './kafka.constants';

@Injectable()
export class KafkaProducerService implements OnModuleInit {
  private readonly logger = new Logger(KafkaProducerService.name);

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafkaClient.connect();
    this.logger.log('Kafka producer connected');
  }

  publishTransferInitiated(event: TransferInitiatedEvent): void {
    this.kafkaClient.emit(KAFKA_TOPICS.TRANSFER_INITIATED, {
      key: event.transferId,
      value: event,
    });
    this.logger.debug(`Published transfer.initiated: ${event.transferId}`);
  }

  publishTransferCompleted(event: TransferCompletedEvent): void {
    this.kafkaClient.emit(KAFKA_TOPICS.TRANSFER_COMPLETED, {
      key: event.transferId,
      value: event,
    });
    this.logger.debug(`Published transfer.completed: ${event.transferId}`);
  }

  publishTransferFailed(event: TransferFailedEvent): void {
    this.kafkaClient.emit(KAFKA_TOPICS.TRANSFER_FAILED, {
      key: event.transferId,
      value: event,
    });
    this.logger.debug(`Published transfer.failed: ${event.transferId}`);
  }
}
