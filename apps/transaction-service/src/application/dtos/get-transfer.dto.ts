import { IsUUID } from 'class-validator';

export class GetTransferParams {
  @IsUUID()
  transferId!: string;
}
