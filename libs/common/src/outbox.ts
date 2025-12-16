/**
 * Outbox pattern types for reliable event publishing.
 *
 * The outbox pattern ensures that domain changes and event publishing
 * are atomic by writing events to an outbox table in the same transaction
 * as the domain update. A background publisher then polls the outbox
 * and publishes to Kafka.
 */

import { Expose } from 'class-transformer';

/**
 * Aggregate types for outbox entries.
 * Used to identify the domain aggregate the event belongs to.
 */
export enum OutboxAggregateType {
  TRANSFER = 'Transfer',
  WALLET = 'Wallet',
}

/**
 * Event types stored in the outbox.
 * Maps to Kafka topics for routing.
 */
export enum OutboxEventType {
  // Transaction Service events
  TRANSFER_INITIATED = 'TransferInitiated',
  TRANSFER_COMPLETED = 'TransferCompleted',
  TRANSFER_FAILED = 'TransferFailed',

  // Wallet Service events
  WALLET_DEBITED = 'WalletDebited',
  WALLET_DEBIT_FAILED = 'WalletDebitFailed',
  WALLET_CREDITED = 'WalletCredited',
  WALLET_CREDIT_FAILED = 'WalletCreditFailed',
  WALLET_REFUNDED = 'WalletRefunded',
}

/**
 * Maps outbox event types to Kafka topics.
 */
export const OUTBOX_EVENT_TO_TOPIC: Record<OutboxEventType, string> = {
  [OutboxEventType.TRANSFER_INITIATED]: 'transfer.initiated',
  [OutboxEventType.TRANSFER_COMPLETED]: 'transfer.completed',
  [OutboxEventType.TRANSFER_FAILED]: 'transfer.failed',
  [OutboxEventType.WALLET_DEBITED]: 'wallet.debited',
  [OutboxEventType.WALLET_DEBIT_FAILED]: 'wallet.debit-failed',
  [OutboxEventType.WALLET_CREDITED]: 'wallet.credited',
  [OutboxEventType.WALLET_CREDIT_FAILED]: 'wallet.credit-failed',
  [OutboxEventType.WALLET_REFUNDED]: 'wallet.refunded',
};

/**
 * Outbox entry interface for domain layer.
 */
export class OutboxEntry {
  @Expose()
  readonly id!: string;

  @Expose()
  readonly aggregateType!: OutboxAggregateType;

  @Expose()
  readonly aggregateId!: string;

  @Expose()
  readonly eventType!: OutboxEventType;

  @Expose()
  readonly payload!: Record<string, unknown>;

  @Expose()
  readonly createdAt!: Date;

  @Expose()
  readonly publishedAt!: Date | null;
}

/**
 * Input for creating a new outbox entry.
 */
export interface CreateOutboxEntry {
  readonly aggregateType: OutboxAggregateType;
  readonly aggregateId: string;
  readonly eventType: OutboxEventType;
  readonly payload: Record<string, unknown>;
}

/** Polling interval for outbox publisher (ms) */
export const OUTBOX_POLLING_INTERVAL_MS = 50;

/** Default batch size for outbox publishing */
export const OUTBOX_BATCH_SIZE = 100;
