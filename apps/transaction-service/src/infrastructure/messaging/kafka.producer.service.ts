import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import {
  KAFKA_TOPICS,
  type TransferInitiatedEvent,
  type TransferCompletedEvent,
  type TransferFailedEvent,
  type WalletCreditFailedEvent,
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
    this.logger.debug('Kafka producer connected');
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

  /**
   * Publish wallet.credit-failed event to trigger compensation.
   * Used by SagaTimeoutService for stuck DEBITED transfers.
   *
   * Note: This is a cross-domain event publication for recovery purposes.
   * In normal flow, wallet service publishes this event.
   */
  publishWalletCreditFailedForCompensation(
    event: WalletCreditFailedEvent,
  ): void {
    this.kafkaClient.emit(KAFKA_TOPICS.WALLET_CREDIT_FAILED, {
      key: event.transferId,
      value: event,
    });
    this.logger.warn(
      `Published wallet.credit-failed for compensation: ${event.transferId}`,
    );
  }
}
