import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Expose } from 'class-transformer';
import { bigIntTransformer, LedgerEntryType } from '@app/common';
import { WalletOrmEntity } from './wallet.orm-entity';

@Entity('wallet_ledger_entries')
@Index(['walletId', 'transactionId'], { unique: true })
export class WalletLedgerEntryOrmEntity {
  @PrimaryColumn('uuid', { name: 'entry_id' })
  @Expose()
  entryId!: string;

  @Column('uuid', { name: 'wallet_id' })
  @Expose()
  walletId!: string;

  @Column('uuid', { name: 'transaction_id' })
  @Expose()
  transactionId!: string;

  @Column({
    type: 'varchar',
    length: 10,
  })
  @Expose()
  type!: LedgerEntryType;

  @Column('bigint', { transformer: bigIntTransformer })
  @Expose()
  amount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Expose()
  createdAt!: Date;

  @ManyToOne(() => WalletOrmEntity)
  @JoinColumn({ name: 'wallet_id' })
  wallet?: WalletOrmEntity;
}
