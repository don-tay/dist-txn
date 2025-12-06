import { Expose, plainToInstance } from 'class-transformer';

interface WalletProps {
  readonly walletId: string;
  readonly userId: string;
  readonly balance: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Domain entity representing a user's wallet.
 *
 * Encapsulates wallet identity, ownership, balance, and timestamps.
 * Use the static {@link Wallet.create} factory method for explicit instantiation.
 */
export class Wallet {
  @Expose()
  readonly walletId!: string;

  @Expose()
  readonly userId!: string;

  @Expose()
  readonly balance!: number;

  @Expose()
  readonly createdAt!: Date;

  @Expose()
  readonly updatedAt!: Date;

  /**
   * Factory method to create a new Wallet instance.
   *
   * @param props - The wallet properties
   * @returns A new Wallet instance
   */
  static create(props: WalletProps): Wallet {
    return plainToInstance(Wallet, props, { excludeExtraneousValues: true });
  }
}
