import type { Wallet } from '../entities/wallet.entity';
import type { WalletLedgerEntry } from '../entities/wallet-ledger-entry.entity';
import type { LedgerEntryType } from '@app/common';

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');

export interface DebitCreditResult {
  wallet: Wallet;
  ledgerEntry: WalletLedgerEntry;
}

export interface WalletRepository {
  save(wallet: Wallet): Promise<Wallet>;
  findById(walletId: string): Promise<Wallet | null>;
  existsByUserId(userId: string): Promise<boolean>;
  /**
   * Atomically debit/credit wallet and create ledger entry.
   * Returns existing ledger entry if transactionId already processed (idempotency).
   * Throws if wallet not found or insufficient balance (for debit).
   */
  updateBalanceWithLedger(
    walletId: string,
    transactionId: string,
    amount: number,
    type: LedgerEntryType,
  ): Promise<DebitCreditResult>;
  /**
   * Check if a ledger entry exists for given wallet and transaction (idempotency check).
   */
  findLedgerEntry(
    walletId: string,
    transactionId: string,
  ): Promise<WalletLedgerEntry | null>;
}
