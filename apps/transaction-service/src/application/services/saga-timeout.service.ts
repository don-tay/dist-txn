import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { WalletCreditFailedEvent, TransferFailedEvent } from '@app/common';
import { TransferStatus } from '../../domain/entities/transfer.entity';
import {
  TRANSFER_REPOSITORY,
  type TransferRepository,
  type StuckTransfer,
} from '../../domain/repositories/transfer.repository';
import { KafkaProducerService } from '../../infrastructure/messaging/kafka.producer.service';

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
    private readonly kafkaProducer: KafkaProducerService,
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
   */
  private async handleStuckPending(transferId: string): Promise<void> {
    const updated = await this.transferRepository.updateStatus(
      transferId,
      TransferStatus.PENDING,
      TransferStatus.FAILED,
      'Saga timeout: debit not processed within timeout period',
    );

    if (updated) {
      const failedEvent: TransferFailedEvent = {
        transferId,
        reason: 'Saga timeout: debit not processed within timeout period',
        timestamp: new Date().toISOString(),
      };
      this.kafkaProducer.publishTransferFailed(failedEvent);
      this.logger.log(`Stuck PENDING transfer marked as FAILED: ${transferId}`);
    } else {
      // Already transitioned (concurrent processing) - idempotent
      this.logger.debug(
        `Stuck transfer already processed (concurrent): ${transferId}`,
      );
    }
  }

  /**
   * Handle a transfer stuck in DEBITED state.
   * The sender was debited but credit/completion never happened.
   * Must trigger compensation to refund the sender.
   */
  private async handleStuckDebited(
    transferId: string,
    senderWalletId: string,
    receiverWalletId: string,
    amount: number,
  ): Promise<void> {
    // First, mark the transfer as FAILED
    const updated = await this.transferRepository.updateStatus(
      transferId,
      TransferStatus.DEBITED,
      TransferStatus.FAILED,
      'Saga timeout: credit not processed within timeout period',
    );

    if (updated) {
      // Publish transfer.failed event
      const failedEvent: TransferFailedEvent = {
        transferId,
        reason: 'Saga timeout: credit not processed within timeout period',
        timestamp: new Date().toISOString(),
      };
      this.kafkaProducer.publishTransferFailed(failedEvent);

      // Trigger compensation by publishing wallet.credit-failed
      // This will cause wallet service to refund the sender
      const compensationEvent: WalletCreditFailedEvent = {
        transferId,
        walletId: receiverWalletId,
        reason: 'Saga timeout: triggering compensation',
        senderWalletId,
        amount,
        timestamp: new Date().toISOString(),
      };
      this.kafkaProducer.publishWalletCreditFailedForCompensation(
        compensationEvent,
      );

      this.logger.log(
        `Stuck DEBITED transfer marked as FAILED and compensation triggered: ${transferId}`,
      );
    } else {
      // Already transitioned (concurrent processing) - idempotent
      this.logger.debug(
        `Stuck transfer already processed (concurrent): ${transferId}`,
      );
    }
  }
}
