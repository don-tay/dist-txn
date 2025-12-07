import type { Transfer, TransferStatus } from '../entities/transfer.entity';

export const TRANSFER_REPOSITORY = Symbol('TRANSFER_REPOSITORY');

export interface TransferRepository {
  save(transfer: Transfer): Promise<Transfer>;
  findById(transferId: string): Promise<Transfer | null>;
  /**
   * Update transfer status with optimistic state machine validation.
   *
   * Uses atomic UPDATE with WHERE clause to enforce valid state transitions:
   * - PENDING → DEBITED (debit succeeded)
   * - PENDING → FAILED (debit failed)
   * - DEBITED → COMPLETED (credit succeeded)
   * - DEBITED → FAILED (credit failed)
   *
   * @param transferId - The transfer to update
   * @param expectedStatus - Current status to validate (optimistic lock)
   * @param newStatus - Target status to transition to
   * @param failureReason - Optional reason if transitioning to FAILED
   * @returns Updated transfer, or null if not found or invalid transition
   */
  updateStatus(
    transferId: string,
    expectedStatus: TransferStatus,
    newStatus: TransferStatus,
    failureReason?: string | null,
  ): Promise<Transfer | null>;
}
