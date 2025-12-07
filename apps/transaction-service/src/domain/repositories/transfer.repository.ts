import type { Transfer, TransferStatus } from '../entities/transfer.entity';

export const TRANSFER_REPOSITORY = Symbol('TRANSFER_REPOSITORY');

export interface TransferRepository {
  save(transfer: Transfer): Promise<Transfer>;
  findById(transferId: string): Promise<Transfer | null>;
  /**
   * Update transfer status and optionally set failure reason.
   * Returns null if transfer not found.
   */
  updateStatus(
    transferId: string,
    status: TransferStatus,
    failureReason?: string | null,
  ): Promise<Transfer | null>;
}
