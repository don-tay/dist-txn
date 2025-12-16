import type { Wallet } from '../entities/wallet.entity';
import type { WalletLedgerEntry } from '../entities/wallet-ledger-entry.entity';
import type { LedgerEntryType, CreateOutboxEntry } from '@app/common';

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');

export interface DebitCreditResult {
  wallet: Wallet;
  ledgerEntry: WalletLedgerEntry;
  /** True if this was a duplicate operation (idempotent) */
  isDuplicate: boolean;
}

export interface WalletRepository {
  save(wallet: Wallet): Promise<Wallet>;
  findById(walletId: string): Promise<Wallet | null>;
  existsByUserId(userId: string): Promise<boolean>;
  /**
   * Atomically debit/credit wallet, create ledger entry, and optionally write outbox entry.
   * Returns existing ledger entry if transactionId already processed (idempotency).
   * Throws if wallet not found or insufficient balance (for debit).
   *
   * @param walletId - Wallet to update
   * @param transactionId - Transaction ID for idempotency
   * @param amount - Amount to debit/credit
   * @param type - Type of ledger entry
   * @param outboxEntry - Optional outbox entry to write in same transaction
   */
  updateBalanceWithLedger(
    walletId: string,
    transactionId: string,
    amount: number,
    type: LedgerEntryType,
    outboxEntry?: CreateOutboxEntry,
  ): Promise<DebitCreditResult>;
  /**
   * Check if a ledger entry exists for given wallet and transaction (idempotency check).
   */
  findLedgerEntry(
    walletId: string,
    transactionId: string,
  ): Promise<WalletLedgerEntry | null>;
}
