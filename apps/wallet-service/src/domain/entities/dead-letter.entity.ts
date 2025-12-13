import { Expose } from 'class-transformer';

/**
 * Status of a dead letter entry.
 */
export enum DeadLetterStatus {
  /** Waiting to be processed/replayed */
  PENDING = 'PENDING',
  /** Successfully replayed */
  PROCESSED = 'PROCESSED',
  /** Replay attempted but failed again */
  FAILED = 'FAILED',
}

/**
 * Domain entity representing a failed message that has been moved to the DLQ.
 * Contains all context needed for debugging and replay.
 */
export class DeadLetter {
  @Expose()
  readonly id!: string;

  @Expose()
  readonly originalTopic!: string;

  @Expose()
  readonly originalPayload!: Record<string, unknown>;

  @Expose()
  readonly errorMessage!: string;

  @Expose()
  readonly errorStack!: string | null;

  @Expose()
  readonly attemptCount!: number;

  @Expose()
  readonly firstAttemptAt!: Date;

  @Expose()
  readonly lastAttemptAt!: Date;

  @Expose()
  readonly status!: DeadLetterStatus;

  @Expose()
  readonly processedAt!: Date | null;

  @Expose()
  readonly createdAt!: Date;
}
