import type {
  DeadLetter,
  DeadLetterStatus,
} from '../entities/dead-letter.entity';

/**
 * Repository interface for dead letter queue operations.
 */
export interface DeadLetterRepository {
  /**
   * Save a new dead letter entry.
   */
  save(deadLetter: DeadLetter): Promise<DeadLetter>;

  /**
   * Find a dead letter by ID.
   */
  findById(id: string): Promise<DeadLetter | null>;

  /**
   * Find all dead letters, optionally filtered by status.
   */
  findAll(status?: DeadLetterStatus): Promise<DeadLetter[]>;

  /**
   * Update the status of a dead letter.
   */
  updateStatus(
    id: string,
    status: DeadLetterStatus,
    processedAt?: Date,
  ): Promise<DeadLetter | null>;
}

export const DEAD_LETTER_REPOSITORY = Symbol('DEAD_LETTER_REPOSITORY');
