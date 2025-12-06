import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Check,
} from 'typeorm';
import { Expose } from 'class-transformer';
import { bigIntTransformer } from '@app/common';

@Entity('wallets')
@Check('"balance" >= 0')
export class WalletOrmEntity {
  @PrimaryColumn('uuid', { name: 'wallet_id' })
  @Expose()
  walletId!: string;

  @Column('uuid', { name: 'user_id' })
  @Index({ unique: true })
  @Expose()
  userId!: string;

  @Column('bigint', { default: 0, transformer: bigIntTransformer })
  @Expose()
  balance!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Expose()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Expose()
  updatedAt!: Date;
}
