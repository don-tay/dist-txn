import { v5 as uuidv5 } from 'uuid';

/**
 * Namespace UUID for generating refund transaction IDs.
 * This is a fixed UUID used as the namespace for UUID v5 generation.
 */
const REFUND_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace

/**
 * Generate a deterministic refund transaction ID from the original transfer ID.
 *
 * Uses UUID v5 to create a reproducible UUID that is:
 * - Different from the original transfer ID
 * - Always the same for the same transfer (idempotency)
 * - A valid UUID format for database storage
 *
 * @param transferId - The original transfer/transaction ID
 * @returns A deterministic UUID for the refund transaction
 */
export function generateRefundTransactionId(transferId: string): string {
  return uuidv5(`refund:${transferId}`, REFUND_NAMESPACE);
}
