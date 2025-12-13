import { Injectable, Inject, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { plainToInstance } from 'class-transformer';
import {
  DeadLetter,
  DeadLetterStatus,
} from '../../domain/entities/dead-letter.entity';
import {
  DEAD_LETTER_REPOSITORY,
  type DeadLetterRepository,
} from '../../domain/repositories/dead-letter.repository';

/**
 * Service for handling Dead Letter Queue operations.
 * Routes failed messages to DLQ and provides access for admin operations.
 */
@Injectable()
export class DlqService {
  private readonly logger = new Logger(DlqService.name);

  constructor(
    @Inject(DEAD_LETTER_REPOSITORY)
    private readonly deadLetterRepository: DeadLetterRepository,
  ) {}

  /**
   * Route a failed message to the DLQ after retries are exhausted.
   *
   * @param topic - The Kafka topic this message came from
   * @param payload - The message payload
   * @param error - The final error after all retries
   * @param attemptCount - Number of retry attempts made
   */
  async routeToDlq(
    topic: string,
    payload: Record<string, unknown>,
    error: Error,
    attemptCount: number,
  ): Promise<DeadLetter> {
    const now = new Date();
    const deadLetter = plainToInstance(
      DeadLetter,
      {
        id: uuidv7(),
        originalTopic: topic,
        originalPayload: payload,
        errorMessage: error.message,
        errorStack: error.stack ?? null,
        attemptCount,
        firstAttemptAt: now,
        lastAttemptAt: now,
        status: DeadLetterStatus.PENDING,
        processedAt: null,
        createdAt: now,
      },
      { excludeExtraneousValues: true },
    );

    const saved = await this.deadLetterRepository.save(deadLetter);

    this.logger.warn(
      `Message routed to DLQ: topic=${topic}, id=${saved.id}, error=${error.message}`,
    );

    return saved;
  }

  /**
   * Get all DLQ entries, optionally filtered by status.
   */
  async getAll(status?: DeadLetterStatus): Promise<DeadLetter[]> {
    return this.deadLetterRepository.findAll(status);
  }

  /**
   * Get a specific DLQ entry by ID.
   */
  async getById(id: string): Promise<DeadLetter | null> {
    return this.deadLetterRepository.findById(id);
  }

  /**
   * Mark a DLQ entry as processed.
   */
  async markProcessed(id: string): Promise<DeadLetter | null> {
    return this.deadLetterRepository.updateStatus(
      id,
      DeadLetterStatus.PROCESSED,
      new Date(),
    );
  }

  /**
   * Mark a DLQ entry as failed (after replay attempt).
   */
  async markFailed(id: string): Promise<DeadLetter | null> {
    return this.deadLetterRepository.updateStatus(id, DeadLetterStatus.FAILED);
  }
}
