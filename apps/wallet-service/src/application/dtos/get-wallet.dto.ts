import { IsUUID } from 'class-validator';

export class GetWalletParams {
  @IsUUID()
  walletId!: string;
}
