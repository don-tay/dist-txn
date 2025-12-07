import { Controller, Inject, Logger } from '@nestjs/common';
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from '@nestjs/microservices';
import {
  KAFKA_TOPICS,
  type WalletDebitedEvent,
  type WalletDebitFailedEvent,
  type WalletCreditedEvent,
  type WalletRefundedEvent,
  type TransferCompletedEvent,
  type TransferFailedEvent,
} from '@app/common';
import { TransferStatus } from '../../domain/entities/transfer.entity';
import {
  TRANSFER_REPOSITORY,
  type TransferRepository,
} from '../../domain/repositories/transfer.repository';
import { KafkaProducerService } from './kafka.producer.service';

@Controller()
export class KafkaEventHandler {
  private readonly logger = new Logger(KafkaEventHandler.name);

  constructor(
    @Inject(TRANSFER_REPOSITORY)
    private readonly transferRepository: TransferRepository,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  @EventPattern(KAFKA_TOPICS.WALLET_DEBITED)
  async handleWalletDebited(
    @Payload() event: WalletDebitedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.log(`Received wallet.debited: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    await this.transferRepository.updateStatus(
      event.transferId,
      TransferStatus.DEBITED,
    );
  }

  @EventPattern(KAFKA_TOPICS.WALLET_DEBIT_FAILED)
  async handleWalletDebitFailed(
    @Payload() event: WalletDebitFailedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.log(`Received wallet.debit-failed: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    const transfer = await this.transferRepository.updateStatus(
      event.transferId,
      TransferStatus.FAILED,
      event.reason,
    );

    if (transfer) {
      const failedEvent: TransferFailedEvent = {
        transferId: event.transferId,
        reason: event.reason,
        timestamp: new Date().toISOString(),
      };
      this.kafkaProducer.publishTransferFailed(failedEvent);
    }
  }

  @EventPattern(KAFKA_TOPICS.WALLET_CREDITED)
  async handleWalletCredited(
    @Payload() event: WalletCreditedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.log(`Received wallet.credited: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    const transfer = await this.transferRepository.updateStatus(
      event.transferId,
      TransferStatus.COMPLETED,
    );

    if (transfer) {
      const completedEvent: TransferCompletedEvent = {
        transferId: event.transferId,
        timestamp: new Date().toISOString(),
      };
      this.kafkaProducer.publishTransferCompleted(completedEvent);
    }
  }

  @EventPattern(KAFKA_TOPICS.WALLET_REFUNDED)
  handleWalletRefunded(
    @Payload() event: WalletRefundedEvent,
    @Ctx() context: KafkaContext,
  ): void {
    this.logger.log(`Received wallet.refunded: ${JSON.stringify(event)}`);
    // Transfer should already be FAILED from credit-failed handling
    // This is logged for audit purposes
    void context.getHeartbeat()();
  }
}
