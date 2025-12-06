import { Expose, plainToInstance } from 'class-transformer';

/**
 * Enum representing the possible states of a transfer in the saga.
 */
export enum TransferStatus {
  PENDING = 'PENDING',
  DEBITED = 'DEBITED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

interface TransferProps {
  readonly transferId: string;
  readonly senderWalletId: string;
  readonly receiverWalletId: string;
  readonly amount: number;
  readonly status: TransferStatus;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Domain entity representing a transfer between two wallets.
 *
 * Encapsulates transfer identity, participants, amount, and saga state.
 * Use the static {@link Transfer.create} factory method for explicit instantiation.
 */
export class Transfer {
  @Expose()
  readonly transferId!: string;

  @Expose()
  readonly senderWalletId!: string;

  @Expose()
  readonly receiverWalletId!: string;

  @Expose()
  readonly amount!: number;

  @Expose()
  readonly status!: TransferStatus;

  @Expose()
  readonly failureReason!: string | null;

  @Expose()
  readonly createdAt!: Date;

  @Expose()
  readonly updatedAt!: Date;

  /**
   * Factory method to create a new Transfer instance.
   *
   * @param props - The transfer properties
   * @returns A new Transfer instance
   */
  static create(props: TransferProps): Transfer {
    return plainToInstance(Transfer, props, { excludeExtraneousValues: true });
  }
}
