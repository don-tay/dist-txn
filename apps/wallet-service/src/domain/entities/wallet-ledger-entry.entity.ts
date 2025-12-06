import { Expose, plainToInstance } from 'class-transformer';
import { LedgerEntryType } from '@app/common';

interface WalletLedgerEntryProps {
  readonly entryId: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly type: LedgerEntryType;
  readonly amount: number;
  readonly createdAt: Date;
}

/**
 * Domain entity representing a ledger entry for wallet transactions.
 *
 * Provides idempotency via unique constraint on (walletId, transactionId)
 * and audit trail for all wallet balance changes.
 */
export class WalletLedgerEntry {
  @Expose()
  readonly entryId!: string;

  @Expose()
  readonly walletId!: string;

  @Expose()
  readonly transactionId!: string;

  @Expose()
  readonly type!: LedgerEntryType;

  @Expose()
  readonly amount!: number;

  @Expose()
  readonly createdAt!: Date;

  /**
   * Factory method to create a new WalletLedgerEntry instance.
   */
  static create(props: WalletLedgerEntryProps): WalletLedgerEntry {
    return plainToInstance(WalletLedgerEntry, props, {
      excludeExtraneousValues: true,
    });
  }
}
