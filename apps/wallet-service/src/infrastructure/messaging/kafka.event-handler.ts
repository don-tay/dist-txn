import { Controller, Inject, Logger } from '@nestjs/common';
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from '@nestjs/microservices';
import {
  KAFKA_TOPICS,
  LedgerEntryType,
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
} from '../../domain/repositories/wallet.repository';
import { KafkaProducerService } from './kafka.producer.service';

@Controller()
export class KafkaEventHandler {
  private readonly logger = new Logger(KafkaEventHandler.name);

  constructor(
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepository: WalletRepository,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  /**
   * Handle transfer.initiated event - debit sender wallet.
   */
  @EventPattern(KAFKA_TOPICS.TRANSFER_INITIATED)
  async handleTransferInitiated(
    @Payload() event: TransferInitiatedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.log(`Received transfer.initiated: ${JSON.stringify(event)}`);
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
      this.logger.log(
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
    this.logger.log(`Received wallet.debited: ${JSON.stringify(event)}`);
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
      this.logger.log(
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
   */
  @EventPattern(KAFKA_TOPICS.WALLET_CREDIT_FAILED)
  async handleWalletCreditFailed(
    @Payload() event: WalletCreditFailedEvent,
    @Ctx() context: KafkaContext,
  ): Promise<void> {
    this.logger.log(`Received wallet.credit-failed: ${JSON.stringify(event)}`);
    const heartbeat = context.getHeartbeat();
    await heartbeat();

    try {
      const result = await this.walletRepository.updateBalanceWithLedger(
        event.senderWalletId,
        `${event.transferId}-refund`,
        event.amount,
        LedgerEntryType.REFUND,
      );

      const refundedEvent: WalletRefundedEvent = {
        transferId: event.transferId,
        walletId: event.senderWalletId,
        amount: event.amount,
        timestamp: new Date().toISOString(),
      };
      this.kafkaProducer.publishWalletRefunded(refundedEvent);
      this.logger.log(
        `Refunded wallet ${event.senderWalletId}, new balance: ${String(result.wallet.balance)}`,
      );
    } catch (error) {
      // TODO(Phase 4): Implement DLQ or retry mechanism for failed refunds.
      // Failed refunds leave sender's balance debited without compensation,
      // requiring manual intervention or alerting system.
      this.logger.error(
        `CRITICAL: Refund failed for wallet ${event.senderWalletId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
