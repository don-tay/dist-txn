import { IsUUID, IsInt, Min, Validate } from 'class-validator';
import type {
  ValidationArguments,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ValidatorConstraint } from 'class-validator';

@ValidatorConstraint({ name: 'differentWallets', async: false })
class DifferentWalletsConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as CreateTransferDto;
    return obj.senderWalletId !== obj.receiverWalletId;
  }

  defaultMessage(): string {
    return 'senderWalletId and receiverWalletId must be different';
  }
}

/**
 * Request DTO for initiating a new transfer.
 */
export class CreateTransferDto {
  @IsUUID()
  senderWalletId!: string;

  @IsUUID()
  @Validate(DifferentWalletsConstraint)
  receiverWalletId!: string;

  @IsInt()
  @Min(1, { message: 'amount must be a positive integer' })
  amount!: number;
}
