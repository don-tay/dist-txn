import { Controller, Inject, Logger } from '@nestjs/common';
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from '@nestjs/microservices';
import {
  Retryable,
  BackOffPolicy,
  type RetryOptions,
} from 'typescript-retry-decorator';
import {
  KAFKA_TOPICS,
  LedgerEntryType,
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
import { KafkaProducerService } from './kafka.producer.service';
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
    private readonly kafkaProducer: KafkaProducerService,
    private readonly dlqService: DlqService,
  ) {}

  /**
   * Handle transfer.initiated event - debit sender wallet.
   */
  @EventPattern(KAFKA_TOPICS.TRANSFER_INITIATED)
  async handleTransferInitiated(
    @Payload() event: TransferInitiatedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.debug(`Received transfer.initiated: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    try {
      const result = await this.walletRepository.updateBalanceWithLedger(
        event.senderWalletId,
        event.transferId,
        event.amount,
        LedgerEntryType.DEBIT,
      );

      const debitedEvent: WalletDebitedEvent = {
        transferId: event.transferId,
        walletId: event.senderWalletId,
        amount: event.amount,
        receiverWalletId: event.receiverWalletId,
        timestamp: new Date().toISOString(),
      };
      this.kafkaProducer.publishWalletDebited(debitedEvent);
      this.logger.debug(
        `Debited wallet ${event.senderWalletId}, new balance: ${String(result.wallet.balance)}`,
      );
    } catch (error) {
      const failedEvent: WalletDebitFailedEvent = {
        transferId: event.transferId,
        walletId: event.senderWalletId,
        reason: (error as Error).message,
        timestamp: new Date().toISOString(),
      };
      this.kafkaProducer.publishWalletDebitFailed(failedEvent);
      this.logger.warn(
        `Debit failed for wallet ${event.senderWalletId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Handle wallet.debited event - credit receiver wallet.
   */
  @EventPattern(KAFKA_TOPICS.WALLET_DEBITED)
  async handleWalletDebited(
    @Payload() event: WalletDebitedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.debug(`Received wallet.debited: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    try {
      const result = await this.walletRepository.updateBalanceWithLedger(
        event.receiverWalletId,
        event.transferId,
        event.amount,
        LedgerEntryType.CREDIT,
      );

      const creditedEvent: WalletCreditedEvent = {
        transferId: event.transferId,
        walletId: event.receiverWalletId,
        amount: event.amount,
        timestamp: new Date().toISOString(),
      };
      this.kafkaProducer.publishWalletCredited(creditedEvent);
      this.logger.debug(
        `Credited wallet ${event.receiverWalletId}, new balance: ${String(result.wallet.balance)}`,
      );
    } catch (error) {
      const failedEvent: WalletCreditFailedEvent = {
        transferId: event.transferId,
        walletId: event.receiverWalletId,
        reason: (error as Error).message,
        senderWalletId: event.walletId,
        amount: event.amount,
        timestamp: new Date().toISOString(),
      };
      this.kafkaProducer.publishWalletCreditFailed(failedEvent);
      this.logger.warn(
        `Credit failed for wallet ${event.receiverWalletId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Handle wallet.credit-failed event - refund sender wallet (compensation).
   * Uses retry with exponential backoff, routing to DLQ after max retries.
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
      this.logger.debug(
        `Refunded wallet ${event.senderWalletId}, new balance: ${String(result.wallet.balance)}`,
      );
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
   */
  @Retryable(RETRY_CONFIG)
  private async performRefundWithRetry(
    event: WalletCreditFailedEvent,
  ): Promise<DebitCreditResult> {
    this.logger.debug(`Attempting refund for wallet ${event.senderWalletId}`);

    const refundTransactionId = generateRefundTransactionId(event.transferId);

    const result = await this.walletRepository.updateBalanceWithLedger(
      event.senderWalletId,
      refundTransactionId,
      event.amount,
      LedgerEntryType.REFUND,
    );

    // Publish refund success event
    const refundedEvent: WalletRefundedEvent = {
      transferId: event.transferId,
      walletId: event.senderWalletId,
      amount: event.amount,
      timestamp: new Date().toISOString(),
    };
    this.kafkaProducer.publishWalletRefunded(refundedEvent);

    return result;
  }
}
