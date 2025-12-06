import { Expose } from 'class-transformer';

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
}
