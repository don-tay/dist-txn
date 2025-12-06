import type { ValueTransformer } from 'typeorm';

/**
 * TypeORM transformer for PostgreSQL bigint columns.
 * Converts between database string and JavaScript number types.
 * Handles null/undefined values safely.
 *
 * @remarks
 * Uses JavaScript `number` which is safe for integers up to 2^53 - 1 (Number.MAX_SAFE_INTEGER).
 * For monetary amounts in cents, this supports values up to ~$90 trillion.
 * If larger values are needed, consider migrating to BigInt with custom JSON serialization.
 */
export const bigIntTransformer: ValueTransformer = {
  to: (value: number | null | undefined): string | null =>
    value == null ? null : String(value),
  from: (value: string | null | undefined): number | null =>
    value == null ? null : Number(value),
};
