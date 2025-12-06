import { Expose, Transform } from 'class-transformer';

/**
 * Response DTO for wallet creation (POST).
 * Omits updatedAt as per spec.
 */
export class CreateWalletResponseDto {
  @Expose()
  walletId!: string;

  @Expose()
  userId!: string;

  @Expose()
  balance!: number;

  @Expose()
  @Transform(({ value }: { value: Date }) => value.toISOString())
  createdAt!: string;
}

/**
 * Response DTO for wallet retrieval (GET).
 */
export class WalletResponseDto extends CreateWalletResponseDto {
  @Expose()
  @Transform(({ value }: { value: Date }) => value.toISOString())
  updatedAt!: string;
}
