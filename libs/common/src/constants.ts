// Kafka Topics
export const KAFKA_TOPICS = {
  TRANSFER_INITIATED: 'transfer.initiated',
  WALLET_DEBITED: 'wallet.debited',
  WALLET_DEBIT_FAILED: 'wallet.debit-failed',
  WALLET_CREDITED: 'wallet.credited',
  WALLET_CREDIT_FAILED: 'wallet.credit-failed',
  WALLET_REFUNDED: 'wallet.refunded',
  TRANSFER_COMPLETED: 'transfer.completed',
  TRANSFER_FAILED: 'transfer.failed',
} as const;

// Transfer Status
export enum TransferStatus {
  PENDING = 'PENDING',
  DEBITED = 'DEBITED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// Wallet Ledger Entry Types
export enum LedgerEntryType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
  REFUND = 'REFUND',
}

// Service Ports
export const SERVICE_PORTS = {
  TRANSACTION_SERVICE: 3000,
  WALLET_SERVICE: 3001,
} as const;
