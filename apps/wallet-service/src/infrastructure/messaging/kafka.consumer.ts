import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, logLevel } from 'kafkajs';
import {
  KAFKA_TOPICS,
  LedgerEntryType,
  TransferInitiatedEvent,
  WalletDebitedEvent,
  WalletDebitFailedEvent,
  WalletCreditedEvent,
  WalletCreditFailedEvent,
  WalletRefundedEvent,
} from '@app/common';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
} from '../../domain/repositories/wallet.repository';
import { KafkaProducer } from './kafka.producer';

@Injectable()
export class KafkaConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumer.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepository: WalletRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {
    this.kafka = new Kafka({
      clientId: 'wallet-service-consumer',
      brokers: [
        this.configService.get<string>('KAFKA_BROKER', 'localhost:9092'),
      ],
      logLevel: logLevel.WARN,
    });
    this.consumer = this.kafka.consumer({
      groupId: 'wallet-service-group',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [
        KAFKA_TOPICS.TRANSFER_INITIATED,
        KAFKA_TOPICS.WALLET_DEBITED,
        KAFKA_TOPICS.WALLET_CREDIT_FAILED,
      ],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const value = message.value?.toString();
        if (!value) return;

        try {
          const parsed: unknown = JSON.parse(value);
          switch (topic) {
            case KAFKA_TOPICS.TRANSFER_INITIATED:
              await this.handleTransferInitiated(
                parsed as TransferInitiatedEvent,
              );
              break;
            case KAFKA_TOPICS.WALLET_DEBITED:
              await this.handleWalletDebited(parsed as WalletDebitedEvent);
              break;
            case KAFKA_TOPICS.WALLET_CREDIT_FAILED:
              await this.handleWalletCreditFailed(
                parsed as WalletCreditFailedEvent,
              );
              break;
          }
        } catch (error) {
          this.logger.error(
            `Error processing message from ${topic}: ${String(error)}`,
            (error as Error).stack,
          );
        }
      },
    });
    this.logger.log('Kafka consumer connected and listening');
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }

  /**
   * Handle transfer.initiated event - debit sender wallet.
   */
  private async handleTransferInitiated(
    event: TransferInitiatedEvent,
  ): Promise<void> {
    this.logger.log(`Received transfer.initiated: ${JSON.stringify(event)}`);

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
      await this.kafkaProducer.publishWalletDebited(debitedEvent);
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
      await this.kafkaProducer.publishWalletDebitFailed(failedEvent);
      this.logger.warn(
        `Debit failed for wallet ${event.senderWalletId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Handle wallet.debited event - credit receiver wallet.
   */
  private async handleWalletDebited(event: WalletDebitedEvent): Promise<void> {
    this.logger.log(`Received wallet.debited: ${JSON.stringify(event)}`);

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
      await this.kafkaProducer.publishWalletCredited(creditedEvent);
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
      await this.kafkaProducer.publishWalletCreditFailed(failedEvent);
      this.logger.warn(
        `Credit failed for wallet ${event.receiverWalletId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Handle wallet.credit-failed event - refund sender wallet (compensation).
   */
  private async handleWalletCreditFailed(
    event: WalletCreditFailedEvent,
  ): Promise<void> {
    this.logger.log(`Received wallet.credit-failed: ${JSON.stringify(event)}`);

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
      await this.kafkaProducer.publishWalletRefunded(refundedEvent);
      this.logger.log(
        `Refunded wallet ${event.senderWalletId}, new balance: ${String(result.wallet.balance)}`,
      );
    } catch (error) {
      this.logger.error(
        `CRITICAL: Refund failed for wallet ${event.senderWalletId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
