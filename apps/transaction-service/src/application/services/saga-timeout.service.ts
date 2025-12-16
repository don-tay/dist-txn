import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import {
  OutboxAggregateType,
  OutboxEventType,
  type WalletCreditFailedEvent,
  type TransferFailedEvent,
} from '@app/common';
import { TransferStatus } from '../../domain/entities/transfer.entity';
import {
  TRANSFER_REPOSITORY,
  type TransferRepository,
  type StuckTransfer,
} from '../../domain/repositories/transfer.repository';
import { TransferOrmEntity } from '../../infrastructure/persistence/transfer.orm-entity';
import { OutboxOrmEntity } from '../../infrastructure/persistence/outbox.orm-entity';

/**
 * Service responsible for detecting and recovering stuck sagas.
 *
 * Runs periodically to find transfers that have timed out and are stuck
 * in non-terminal states (PENDING or DEBITED).
 *
 * Recovery Strategy:
 * - PENDING → FAILED: Debit never happened, safe to fail
 * - DEBITED → FAILED + compensation: Must refund sender
 */
@Injectable()
export class SagaTimeoutService {
  private readonly logger = new Logger(SagaTimeoutService.name);

  constructor(
    @Inject(TRANSFER_REPOSITORY)
    private readonly transferRepository: TransferRepository,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Scheduled job to check for and recover stuck transfers.
   * Runs every 10 seconds.
   */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleStuckTransfers(): Promise<void> {
    const stuckTransfers = await this.transferRepository.findStuckTransfers();

    if (stuckTransfers.length === 0) {
      return;
    }

    this.logger.log(`Found ${String(stuckTransfers.length)} stuck transfer(s)`);

    for (const stuck of stuckTransfers) {
      try {
        await this.recoverStuckTransfer(stuck);
      } catch (error) {
        // Log and continue - one failed recovery shouldn't prevent others
        this.logger.error(
          `Failed to recover stuck transfer: ${stuck.transfer.transferId}. ` +
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  /**
   * Recover a single stuck transfer based on its current status.
   */
  private async recoverStuckTransfer(stuck: StuckTransfer): Promise<void> {
    const { transfer, receiverWalletId, amount } = stuck;

    this.logger.warn(
      `Recovering stuck transfer: ${transfer.transferId}, status: ${transfer.status}`,
    );

    switch (transfer.status) {
      case TransferStatus.PENDING:
        await this.handleStuckPending(transfer.transferId);
        break;
      case TransferStatus.DEBITED:
        await this.handleStuckDebited(
          transfer.transferId,
          transfer.senderWalletId,
          receiverWalletId,
          amount,
        );
        break;
      default:
        // Should not happen - findStuckTransfers only returns PENDING/DEBITED
        this.logger.error(
          `Unexpected stuck transfer status: ${transfer.status}`,
        );
    }
  }

  /**
   * Handle a transfer stuck in PENDING state.
   * The debit never happened, so we can safely mark it as FAILED.
   * Uses outbox pattern for reliable event publishing.
   */
  private async handleStuckPending(transferId: string): Promise<void> {
    const failureReason =
      'Saga timeout: debit not processed within timeout period';
    const timestamp = new Date().toISOString();

    const failedEvent: TransferFailedEvent = {
      transferId,
      reason: failureReason,
      timestamp,
    };

    const updated = await this.dataSource.transaction(async (manager) => {
      const transferRepo = manager.getRepository(TransferOrmEntity);
      const outboxRepo = manager.getRepository(OutboxOrmEntity);

      // Atomic status update with optimistic lock
      const result = await transferRepo
        .createQueryBuilder()
        .update(TransferOrmEntity)
        .set({
          status: TransferStatus.FAILED,
          failureReason,
          updatedAt: new Date(),
        })
        .where('transfer_id = :transferId AND status = :expectedStatus', {
          transferId,
          expectedStatus: TransferStatus.PENDING,
        })
        .execute();

      if ((result.affected ?? 0) > 0) {
        // Write transfer.failed to outbox
        const outboxEntry = outboxRepo.create({
          id: uuidv7(),
          aggregateType: OutboxAggregateType.TRANSFER,
          aggregateId: transferId,
          eventType: OutboxEventType.TRANSFER_FAILED,
          payload: failedEvent as unknown as Record<string, unknown>,
          createdAt: new Date(),
          publishedAt: null,
        });
        await outboxRepo.save(outboxEntry);
        return true;
      }
      return false;
    });

    if (updated) {
      this.logger.log(`Stuck PENDING transfer marked as FAILED: ${transferId}`);
    } else {
      this.logger.debug(
        `Stuck transfer already processed (concurrent): ${transferId}`,
      );
    }
  }

  /**
   * Handle a transfer stuck in DEBITED state.
   * The sender was debited but credit/completion never happened.
   * Must trigger compensation to refund the sender.
   * Uses outbox pattern for reliable event publishing.
   */
  private async handleStuckDebited(
    transferId: string,
    senderWalletId: string,
    receiverWalletId: string,
    amount: number,
  ): Promise<void> {
    const failureReason =
      'Saga timeout: credit not processed within timeout period';
    const timestamp = new Date().toISOString();

    const failedEvent: TransferFailedEvent = {
      transferId,
      reason: failureReason,
      timestamp,
    };

    const compensationEvent: WalletCreditFailedEvent = {
      transferId,
      walletId: receiverWalletId,
      reason: 'Saga timeout: triggering compensation',
      senderWalletId,
      amount,
      timestamp,
    };

    const updated = await this.dataSource.transaction(async (manager) => {
      const transferRepo = manager.getRepository(TransferOrmEntity);
      const outboxRepo = manager.getRepository(OutboxOrmEntity);

      // Atomic status update with optimistic lock
      const result = await transferRepo
        .createQueryBuilder()
        .update(TransferOrmEntity)
        .set({
          status: TransferStatus.FAILED,
          failureReason,
          updatedAt: new Date(),
        })
        .where('transfer_id = :transferId AND status = :expectedStatus', {
          transferId,
          expectedStatus: TransferStatus.DEBITED,
        })
        .execute();

      if ((result.affected ?? 0) > 0) {
        // Write transfer.failed to outbox
        const failedOutbox = outboxRepo.create({
          id: uuidv7(),
          aggregateType: OutboxAggregateType.TRANSFER,
          aggregateId: transferId,
          eventType: OutboxEventType.TRANSFER_FAILED,
          payload: failedEvent as unknown as Record<string, unknown>,
          createdAt: new Date(),
          publishedAt: null,
        });
        await outboxRepo.save(failedOutbox);

        // Write wallet.credit-failed to outbox (for compensation)
        const compensationOutbox = outboxRepo.create({
          id: uuidv7(),
          aggregateType: OutboxAggregateType.TRANSFER,
          aggregateId: transferId,
          eventType: OutboxEventType.WALLET_CREDIT_FAILED,
          payload: compensationEvent as unknown as Record<string, unknown>,
          createdAt: new Date(),
          publishedAt: null,
        });
        await outboxRepo.save(compensationOutbox);

        return true;
      }
      return false;
    });

    if (updated) {
      this.logger.log(
        `Stuck DEBITED transfer marked as FAILED and compensation triggered: ${transferId}`,
      );
    } else {
      this.logger.debug(
        `Stuck transfer already processed (concurrent): ${transferId}`,
      );
    }
  }
}
