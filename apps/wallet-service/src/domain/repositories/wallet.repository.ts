import type { Wallet } from '../entities/wallet.entity';

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');

export interface WalletRepository {
  save(wallet: Wallet): Promise<Wallet>;
  findById(walletId: string): Promise<Wallet | null>;
  existsByUserId(userId: string): Promise<boolean>;
}
