import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import {
  KAFKA_TOPICS,
  type WalletDebitedEvent,
  type WalletDebitFailedEvent,
  type WalletCreditedEvent,
  type WalletCreditFailedEvent,
  type WalletRefundedEvent,
} from '@app/common';
import { KAFKA_CLIENT } from './kafka.constants';

@Injectable()
export class KafkaProducerService implements OnModuleInit {
  private readonly logger = new Logger(KafkaProducerService.name);

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafkaClient: ClientKafka,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.kafkaClient.connect();
    this.logger.log('Kafka producer connected');
  }

  publishWalletDebited(event: WalletDebitedEvent): void {
    this.kafkaClient.emit(KAFKA_TOPICS.WALLET_DEBITED, {
      key: event.transferId,
      value: event,
    });
    this.logger.debug(`Published wallet.debited: ${event.transferId}`);
  }

  publishWalletDebitFailed(event: WalletDebitFailedEvent): void {
    this.kafkaClient.emit(KAFKA_TOPICS.WALLET_DEBIT_FAILED, {
      key: event.transferId,
      value: event,
    });
    this.logger.debug(`Published wallet.debit-failed: ${event.transferId}`);
  }

  publishWalletCredited(event: WalletCreditedEvent): void {
    this.kafkaClient.emit(KAFKA_TOPICS.WALLET_CREDITED, {
      key: event.transferId,
      value: event,
    });
    this.logger.debug(`Published wallet.credited: ${event.transferId}`);
  }

  publishWalletCreditFailed(event: WalletCreditFailedEvent): void {
    this.kafkaClient.emit(KAFKA_TOPICS.WALLET_CREDIT_FAILED, {
      key: event.transferId,
      value: event,
    });
    this.logger.debug(`Published wallet.credit-failed: ${event.transferId}`);
  }

  publishWalletRefunded(event: WalletRefundedEvent): void {
    this.kafkaClient.emit(KAFKA_TOPICS.WALLET_REFUNDED, {
      key: event.transferId,
      value: event,
    });
    this.logger.debug(`Published wallet.refunded: ${event.transferId}`);
  }
}
