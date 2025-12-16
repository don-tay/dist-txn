import { Controller, Logger } from '@nestjs/common';
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import {
  KAFKA_TOPICS,
  OutboxAggregateType,
  OutboxEventType,
  type WalletDebitedEvent,
  type WalletDebitFailedEvent,
  type WalletCreditedEvent,
  type WalletCreditFailedEvent,
  type WalletRefundedEvent,
  type TransferCompletedEvent,
  type TransferFailedEvent,
} from '@app/common';
import { TransferStatus } from '../../domain/entities/transfer.entity';
import { TransferOrmEntity } from '../persistence/transfer.orm-entity';
import { OutboxOrmEntity } from '../persistence/outbox.orm-entity';

@Controller()
export class KafkaEventHandler {
  private readonly logger = new Logger(KafkaEventHandler.name);

  constructor(private readonly dataSource: DataSource) {}

  @EventPattern(KAFKA_TOPICS.WALLET_DEBITED)
  async handleWalletDebited(
    @Payload() event: WalletDebitedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.debug(`Received wallet.debited: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    // State transition: PENDING → DEBITED (no outbox event needed)
    await this.updateTransferStatus(
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

    const failedEvent: TransferFailedEvent = {
      transferId: event.transferId,
      reason: event.reason,
      timestamp: new Date().toISOString(),
    };

    // Atomic: PENDING → FAILED + outbox entry for transfer.failed
    await this.updateStatusWithOutbox(
      event.transferId,
      TransferStatus.PENDING,
      TransferStatus.FAILED,
      event.reason,
      OutboxEventType.TRANSFER_FAILED,
      failedEvent as unknown as Record<string, unknown>,
    );
  }

  @EventPattern(KAFKA_TOPICS.WALLET_CREDITED)
  async handleWalletCredited(
    @Payload() event: WalletCreditedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.debug(`Received wallet.credited: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    const completedEvent: TransferCompletedEvent = {
      transferId: event.transferId,
      timestamp: new Date().toISOString(),
    };

    // Atomic: DEBITED → COMPLETED + outbox entry for transfer.completed
    await this.updateStatusWithOutbox(
      event.transferId,
      TransferStatus.DEBITED,
      TransferStatus.COMPLETED,
      null,
      OutboxEventType.TRANSFER_COMPLETED,
      completedEvent as unknown as Record<string, unknown>,
    );
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

    const failedEvent: TransferFailedEvent = {
      transferId: event.transferId,
      reason: event.reason,
      timestamp: new Date().toISOString(),
    };

    // Atomic: DEBITED → FAILED + outbox entry for transfer.failed
    await this.updateStatusWithOutbox(
      event.transferId,
      TransferStatus.DEBITED,
      TransferStatus.FAILED,
      event.reason,
      OutboxEventType.TRANSFER_FAILED,
      failedEvent as unknown as Record<string, unknown>,
    );
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

  /**
   * Update transfer status without publishing an outbox event.
   */
  private async updateTransferStatus(
    transferId: string,
    expectedStatus: TransferStatus,
    newStatus: TransferStatus,
    failureReason?: string | null,
  ): Promise<boolean> {
    const result = await this.dataSource
      .createQueryBuilder()
      .update(TransferOrmEntity)
      .set({
        status: newStatus,
        failureReason: failureReason ?? null,
        updatedAt: new Date(),
      })
      .where('transferId = :transferId AND status = :expectedStatus', {
        transferId,
        expectedStatus,
      })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Atomically update transfer status and write outbox entry.
   */
  private async updateStatusWithOutbox(
    transferId: string,
    expectedStatus: TransferStatus,
    newStatus: TransferStatus,
    failureReason: string | null,
    eventType: OutboxEventType,
    eventPayload: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const transferRepo = manager.getRepository(TransferOrmEntity);
      const outboxRepo = manager.getRepository(OutboxOrmEntity);

      // Atomic status update with optimistic lock
      const result = await transferRepo
        .createQueryBuilder()
        .update(TransferOrmEntity)
        .set({
          status: newStatus,
          failureReason: failureReason ?? null,
          updatedAt: new Date(),
        })
        .where('transfer_id = :transferId AND status = :expectedStatus', {
          transferId,
          expectedStatus,
        })
        .execute();

      // Only write outbox if status was actually updated
      if ((result.affected ?? 0) > 0) {
        const outboxEntry = outboxRepo.create({
          id: uuidv7(),
          aggregateType: OutboxAggregateType.TRANSFER,
          aggregateId: transferId,
          eventType,
          payload: eventPayload,
          createdAt: new Date(),
          publishedAt: null,
        });
        await outboxRepo.save(outboxEntry);
        this.logger.debug(
          `Created outbox entry ${eventType} for transfer ${transferId}`,
        );
      }
    });
  }
}
