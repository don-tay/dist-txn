import { IsUUID } from 'class-validator';

/**
 * Request DTO for creating a new wallet.
 */
export class CreateWalletDto {
  @IsUUID()
  user_id!: string;
}
