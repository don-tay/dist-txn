import type { ValueTransformer } from 'typeorm';

/**
 * TypeORM transformer for PostgreSQL bigint columns.
 * Converts between database string and application number types.
 * Handles null/undefined values safely.
 */
export const bigIntTransformer: ValueTransformer = {
  to: (value: number | null | undefined): string | null =>
    value == null ? null : String(value),
  from: (value: string | null | undefined): number | null =>
    value == null ? null : Number(value),
};
