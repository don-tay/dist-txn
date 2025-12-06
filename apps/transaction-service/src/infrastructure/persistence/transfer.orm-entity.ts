import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Expose } from 'class-transformer';
import { bigIntTransformer } from '@app/common';
import { TransferStatus } from '../../domain/entities/transfer.entity';

@Entity('transfers')
export class TransferOrmEntity {
  @PrimaryColumn('uuid', { name: 'transfer_id' })
  @Expose()
  transferId!: string;

  @Column('uuid', { name: 'sender_wallet_id' })
  @Expose()
  senderWalletId!: string;

  @Column('uuid', { name: 'receiver_wallet_id' })
  @Expose()
  receiverWalletId!: string;

  @Column('bigint', { transformer: bigIntTransformer })
  @Expose()
  amount!: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: TransferStatus.PENDING,
  })
  @Expose()
  status!: TransferStatus;

  @Column('varchar', { name: 'failure_reason', length: 255, nullable: true })
  @Expose()
  failureReason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  @Expose()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  @Expose()
  updatedAt!: Date;
}
