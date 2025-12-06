import type { ValueTransformer } from 'typeorm';

/**
 * TypeORM transformer for PostgreSQL bigint columns.
 * Converts between database string and application number types.
 */
export const bigIntTransformer: ValueTransformer = {
  to: (value: number): string => String(value),
  from: (value: string): number => Number(value),
};
