import { Controller, Inject, Logger } from '@nestjs/common';
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from '@nestjs/microservices';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import {
  Retryable,
  BackOffPolicy,
  type RetryOptions,
} from 'typescript-retry-decorator';
import {
  KAFKA_TOPICS,
  LedgerEntryType,
  OutboxAggregateType,
  OutboxEventType,
  generateRefundTransactionId,
  type TransferInitiatedEvent,
  type WalletDebitedEvent,
  type WalletDebitFailedEvent,
  type WalletCreditedEvent,
  type WalletCreditFailedEvent,
  type WalletRefundedEvent,
} from '@app/common';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
  type DebitCreditResult,
} from '../../domain/repositories/wallet.repository';
import { OutboxOrmEntity } from '../persistence/outbox.orm-entity';
import { DlqService } from './dlq.service';

/** Retry configuration for compensation operations */
const RETRY_CONFIG = {
  maxAttempts: 3,
  backOffPolicy: BackOffPolicy.ExponentialBackOffPolicy,
  backOff: 100,
  exponentialOption: { maxInterval: 2000, multiplier: 2 },
  useOriginalError: true,
  useConsoleLogger: false,
} satisfies RetryOptions;

@Controller()
export class KafkaEventHandler {
  private readonly logger = new Logger(KafkaEventHandler.name);

  constructor(
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepository: WalletRepository,
    private readonly dlqService: DlqService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Handle transfer.initiated event - debit sender wallet.
   * Uses outbox pattern for reliable event publishing.
   */
  @EventPattern(KAFKA_TOPICS.TRANSFER_INITIATED)
  async handleTransferInitiated(
    @Payload() event: TransferInitiatedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.debug(`Received transfer.initiated: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    const debitedEvent: WalletDebitedEvent = {
      transferId: event.transferId,
      walletId: event.senderWalletId,
      amount: event.amount,
      receiverWalletId: event.receiverWalletId,
      timestamp: new Date().toISOString(),
    };

    try {
      const result = await this.walletRepository.updateBalanceWithLedger(
        event.senderWalletId,
        event.transferId,
        event.amount,
        LedgerEntryType.DEBIT,
        {
          aggregateType: OutboxAggregateType.WALLET,
          aggregateId: event.transferId,
          eventType: OutboxEventType.WALLET_DEBITED,
          payload: debitedEvent as unknown as Record<string, unknown>,
        },
      );

      if (!result.isDuplicate) {
        this.logger.debug(
          `Debited wallet ${event.senderWalletId}, new balance: ${String(result.wallet.balance)}`,
        );
      }
    } catch (error) {
      // Debit failed - write failure event to outbox
      const failedEvent: WalletDebitFailedEvent = {
        transferId: event.transferId,
        walletId: event.senderWalletId,
        reason: (error as Error).message,
        timestamp: new Date().toISOString(),
      };

      await this.writeOutboxEntry(
        OutboxAggregateType.WALLET,
        event.transferId,
        OutboxEventType.WALLET_DEBIT_FAILED,
        failedEvent as unknown as Record<string, unknown>,
      );

      this.logger.warn(
        `Debit failed for wallet ${event.senderWalletId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Handle wallet.debited event - credit receiver wallet.
   * Uses outbox pattern for reliable event publishing.
   */
  @EventPattern(KAFKA_TOPICS.WALLET_DEBITED)
  async handleWalletDebited(
    @Payload() event: WalletDebitedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.debug(`Received wallet.debited: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    const creditedEvent: WalletCreditedEvent = {
      transferId: event.transferId,
      walletId: event.receiverWalletId,
      amount: event.amount,
      timestamp: new Date().toISOString(),
    };

    try {
      const result = await this.walletRepository.updateBalanceWithLedger(
        event.receiverWalletId,
        event.transferId,
        event.amount,
        LedgerEntryType.CREDIT,
        {
          aggregateType: OutboxAggregateType.WALLET,
          aggregateId: event.transferId,
          eventType: OutboxEventType.WALLET_CREDITED,
          payload: creditedEvent as unknown as Record<string, unknown>,
        },
      );

      if (!result.isDuplicate) {
        this.logger.debug(
          `Credited wallet ${event.receiverWalletId}, new balance: ${String(result.wallet.balance)}`,
        );
      }
    } catch (error) {
      // Credit failed - write failure event to outbox
      const failedEvent: WalletCreditFailedEvent = {
        transferId: event.transferId,
        walletId: event.receiverWalletId,
        reason: (error as Error).message,
        senderWalletId: event.walletId,
        amount: event.amount,
        timestamp: new Date().toISOString(),
      };

      await this.writeOutboxEntry(
        OutboxAggregateType.WALLET,
        event.transferId,
        OutboxEventType.WALLET_CREDIT_FAILED,
        failedEvent as unknown as Record<string, unknown>,
      );

      this.logger.warn(
        `Credit failed for wallet ${event.receiverWalletId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Handle wallet.credit-failed event - refund sender wallet (compensation).
   * Uses retry with exponential backoff, routing to DLQ after max retries.
   * Uses outbox pattern for reliable event publishing.
   */
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

    try {
      const result = await this.performRefundWithRetry(event);
      if (!result.isDuplicate) {
        this.logger.debug(
          `Refunded wallet ${event.senderWalletId}, new balance: ${String(result.wallet.balance)}`,
        );
      }
    } catch (error) {
      // All retries exhausted - route to DLQ
      await this.dlqService.routeToDlq(
        KAFKA_TOPICS.WALLET_CREDIT_FAILED,
        event as unknown as Record<string, unknown>,
        error as Error,
        RETRY_CONFIG.maxAttempts,
      );
      this.logger.error(
        `CRITICAL: Refund failed and routed to DLQ for wallet ${event.senderWalletId}`,
      );
    }
  }

  /**
   * Perform refund with retry using typescript-retry-decorator.
   * Retries up to 3 times with exponential backoff (100ms -> 200ms -> 400ms).
   * Uses outbox pattern for reliable event publishing.
   */
  @Retryable(RETRY_CONFIG)
  private async performRefundWithRetry(
    event: WalletCreditFailedEvent,
  ): Promise<DebitCreditResult> {
    this.logger.debug(`Attempting refund for wallet ${event.senderWalletId}`);

    const refundTransactionId = generateRefundTransactionId(event.transferId);

    const refundedEvent: WalletRefundedEvent = {
      transferId: event.transferId,
      walletId: event.senderWalletId,
      amount: event.amount,
      timestamp: new Date().toISOString(),
    };

    const result = await this.walletRepository.updateBalanceWithLedger(
      event.senderWalletId,
      refundTransactionId,
      event.amount,
      LedgerEntryType.REFUND,
      {
        aggregateType: OutboxAggregateType.WALLET,
        aggregateId: event.transferId,
        eventType: OutboxEventType.WALLET_REFUNDED,
        payload: refundedEvent as unknown as Record<string, unknown>,
      },
    );

    return result;
  }

  /**
   * Write an outbox entry directly (for failure cases where no ledger update happens).
   */
  private async writeOutboxEntry(
    aggregateType: OutboxAggregateType,
    aggregateId: string,
    eventType: OutboxEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const outboxRepo = this.dataSource.getRepository(OutboxOrmEntity);
    const outbox = outboxRepo.create({
      id: uuidv7(),
      aggregateType,
      aggregateId,
      eventType,
      payload,
      createdAt: new Date(),
      publishedAt: null,
    });
    await outboxRepo.save(outbox);
  }
}
