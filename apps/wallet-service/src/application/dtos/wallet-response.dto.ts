import { Expose } from 'class-transformer';

/**
 * Response DTO for wallet operations (create and get).
 * Uses snake_case for API response consistency.
 */
export class WalletResponseDto {
  @Expose()
  wallet_id!: string;

  @Expose()
  user_id!: string;

  @Expose()
  balance!: number;

  @Expose()
  created_at!: string;

  @Expose()
  updated_at?: string;
}
