/**
 * Event DTOs for Kafka messaging in the saga choreography.
 * All events follow the same pattern with required fields for correlation and tracing.
 *
 * Events carry full transfer context where needed for saga continuation.
 */

export interface TransferInitiatedEvent {
  readonly transferId: string;
  readonly senderWalletId: string;
  readonly receiverWalletId: string;
  readonly amount: number;
  readonly timestamp: string;
}

export interface WalletDebitedEvent {
  readonly transferId: string;
  readonly walletId: string;
  readonly amount: number;
  /** Receiver wallet ID for saga continuation to credit step */
  readonly receiverWalletId: string;
  readonly timestamp: string;
}

export interface WalletDebitFailedEvent {
  readonly transferId: string;
  readonly walletId: string;
  readonly reason: string;
  readonly timestamp: string;
}

export interface WalletCreditedEvent {
  readonly transferId: string;
  readonly walletId: string;
  readonly amount: number;
  readonly timestamp: string;
}

export interface WalletCreditFailedEvent {
  readonly transferId: string;
  readonly walletId: string;
  readonly reason: string;
  /** Sender wallet ID for compensation/refund */
  readonly senderWalletId: string;
  /** Amount for compensation/refund */
  readonly amount: number;
  readonly timestamp: string;
}

export interface WalletRefundedEvent {
  readonly transferId: string;
  readonly walletId: string;
  readonly amount: number;
  readonly timestamp: string;
}

export interface TransferCompletedEvent {
  readonly transferId: string;
  readonly timestamp: string;
}

export interface TransferFailedEvent {
  readonly transferId: string;
  readonly reason: string;
  readonly timestamp: string;
}
