import { IsUUID } from 'class-validator';
import { Expose, Transform } from 'class-transformer';

export class CreateWalletDto {
  @IsUUID()
  user_id!: string;
}

export class WalletResponseDto {
  @Expose()
  wallet_id!: string;

  @Expose()
  user_id!: string;

  @Expose()
  @Transform(({ value }) => Number(value))
  balance!: number;

  @Expose()
  created_at!: string;

  @Expose()
  updated_at?: string;
}
