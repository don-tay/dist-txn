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
  WalletDebitedEvent,
  WalletDebitFailedEvent,
  WalletCreditedEvent,
  WalletRefundedEvent,
  TransferCompletedEvent,
  TransferFailedEvent,
} from '@app/common';
import { TransferStatus } from '../../domain/entities/transfer.entity';
import {
  TRANSFER_REPOSITORY,
  type TransferRepository,
} from '../../domain/repositories/transfer.repository';
import { KafkaProducer } from './kafka.producer';

@Injectable()
export class KafkaConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumer.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;

  constructor(
    private readonly configService: ConfigService,
    @Inject(TRANSFER_REPOSITORY)
    private readonly transferRepository: TransferRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {
    this.kafka = new Kafka({
      clientId: 'transaction-service-consumer',
      brokers: [
        this.configService.get<string>('KAFKA_BROKER', 'localhost:9092'),
      ],
      logLevel: logLevel.WARN,
    });
    this.consumer = this.kafka.consumer({
      groupId: 'transaction-service-group',
    });
  }

  async onModuleInit(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [
        KAFKA_TOPICS.WALLET_DEBITED,
        KAFKA_TOPICS.WALLET_DEBIT_FAILED,
        KAFKA_TOPICS.WALLET_CREDITED,
        KAFKA_TOPICS.WALLET_REFUNDED,
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
            case KAFKA_TOPICS.WALLET_DEBITED:
              await this.handleWalletDebited(parsed as WalletDebitedEvent);
              break;
            case KAFKA_TOPICS.WALLET_DEBIT_FAILED:
              await this.handleWalletDebitFailed(
                parsed as WalletDebitFailedEvent,
              );
              break;
            case KAFKA_TOPICS.WALLET_CREDITED:
              await this.handleWalletCredited(parsed as WalletCreditedEvent);
              break;
            case KAFKA_TOPICS.WALLET_REFUNDED:
              this.handleWalletRefunded(parsed as WalletRefundedEvent);
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

  private async handleWalletDebited(event: WalletDebitedEvent): Promise<void> {
    this.logger.log(`Received wallet.debited: ${JSON.stringify(event)}`);
    await this.transferRepository.updateStatus(
      event.transferId,
      TransferStatus.DEBITED,
    );
  }

  private async handleWalletDebitFailed(
    event: WalletDebitFailedEvent,
  ): Promise<void> {
    this.logger.log(`Received wallet.debit-failed: ${JSON.stringify(event)}`);
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
      await this.kafkaProducer.publishTransferFailed(failedEvent);
    }
  }

  private async handleWalletCredited(
    event: WalletCreditedEvent,
  ): Promise<void> {
    this.logger.log(`Received wallet.credited: ${JSON.stringify(event)}`);
    const transfer = await this.transferRepository.updateStatus(
      event.transferId,
      TransferStatus.COMPLETED,
    );

    if (transfer) {
      const completedEvent: TransferCompletedEvent = {
        transferId: event.transferId,
        timestamp: new Date().toISOString(),
      };
      await this.kafkaProducer.publishTransferCompleted(completedEvent);
    }
  }

  private handleWalletRefunded(event: WalletRefundedEvent): void {
    this.logger.log(`Received wallet.refunded: ${JSON.stringify(event)}`);
    // Transfer should already be FAILED from credit-failed handling
    // This is logged for audit purposes
  }
}
