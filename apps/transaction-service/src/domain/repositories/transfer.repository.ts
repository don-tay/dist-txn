import type { Transfer } from '../entities/transfer.entity';

export const TRANSFER_REPOSITORY = Symbol('TRANSFER_REPOSITORY');

export interface TransferRepository {
  save(transfer: Transfer): Promise<Transfer>;
  findById(transferId: string): Promise<Transfer | null>;
}
