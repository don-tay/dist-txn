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
  type WalletCreditFailedEvent,
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
    this.logger.debug(`Received wallet.debited: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    // State transition: PENDING → DEBITED
    await this.transferRepository.updateStatus(
      event.transferId,
      TransferStatus.PENDING,
      TransferStatus.DEBITED,
    );
  }

  @EventPattern(KAFKA_TOPICS.WALLET_DEBIT_FAILED)
  async handleWalletDebitFailed(
    @Payload() event: WalletDebitFailedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.debug(`Received wallet.debit-failed: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    // State transition: PENDING → FAILED (debit failed, nothing to compensate)
    const transfer = await this.transferRepository.updateStatus(
      event.transferId,
      TransferStatus.PENDING,
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
    this.logger.debug(`Received wallet.credited: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    // State transition: DEBITED → COMPLETED (happy path complete)
    const transfer = await this.transferRepository.updateStatus(
      event.transferId,
      TransferStatus.DEBITED,
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

  @EventPattern(KAFKA_TOPICS.WALLET_CREDIT_FAILED)
  async handleWalletCreditFailed(
    @Payload() event: WalletCreditFailedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.debug(
      `Received wallet.credit-failed: ${JSON.stringify(event)}`,
    );
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    // State transition: DEBITED → FAILED (credit failed, compensation in progress)
    const transfer = await this.transferRepository.updateStatus(
      event.transferId,
      TransferStatus.DEBITED,
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

  @EventPattern(KAFKA_TOPICS.WALLET_REFUNDED)
  async handleWalletRefunded(
    @Payload() event: WalletRefundedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.debug(`Received wallet.refunded: ${JSON.stringify(event)}`);
    // Transfer should already be FAILED from credit-failed handling
    // This is logged for audit purposes
    const heartbeat = context.getHeartbeat();
    await heartbeat();
  }
}
