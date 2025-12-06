import { Expose, Transform } from 'class-transformer';

/**
 * Response DTO for transfer creation (POST).
 * Omits updatedAt and failureReason as per spec.
 */
export class CreateTransferResponseDto {
  @Expose()
  transferId!: string;

  @Expose()
  senderWalletId!: string;

  @Expose()
  receiverWalletId!: string;

  @Expose()
  amount!: number;

  @Expose()
  status!: string;

  @Expose()
  @Transform(({ value }: { value: Date }) => value.toISOString())
  createdAt!: string;
}

/**
 * Response DTO for transfer retrieval (GET).
 */
export class TransferResponseDto extends CreateTransferResponseDto {
  @Expose()
  failureReason!: string | null;

  @Expose()
  @Transform(({ value }: { value: Date }) => value.toISOString())
  updatedAt!: string;
}
