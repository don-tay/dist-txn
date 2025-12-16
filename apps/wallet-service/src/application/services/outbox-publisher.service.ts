import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import {
  OUTBOX_POLLING_INTERVAL_MS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_EVENT_TO_TOPIC,
} from '@app/common';
import { OutboxOrmEntity } from '../../infrastructure/persistence/outbox.orm-entity';
import { KafkaProducerService } from '../../infrastructure/messaging/kafka.producer.service';

/**
 * Background service that polls the outbox table and publishes events to Kafka.
 *
 * This implements the "polling publisher" variant of the outbox pattern:
 * 1. Select unpublished entries with FOR UPDATE SKIP LOCKED (row-level lock)
 * 2. Publish each entry to Kafka
 * 3. Mark entries as published
 * 4. Commit transaction (automatically releases row locks)
 *
 * Benefits of FOR UPDATE SKIP LOCKED:
 * - Automatic lock release on transaction commit/rollback (crash-safe)
 * - Multiple instances can process different batches concurrently
 * - No explicit unlock needed, no risk of orphaned locks
 * - Built-in skip behavior for already-locked rows
 *
 * Events are published in order (per aggregate) by polling in createdAt order.
 * Failed publishes are retried on the next polling cycle.
 */
@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);

  constructor(
    private readonly kafkaProducer: KafkaProducerService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Scheduled job to poll and publish outbox entries.
   * Uses a 50ms interval for near-real-time event delivery.
   */
  @Interval(OUTBOX_POLLING_INTERVAL_MS)
  async pollAndPublish(): Promise<void> {
    await this.processOutbox();
  }

  /**
   * Process unpublished outbox entries within a transaction.
   * Uses FOR UPDATE SKIP LOCKED for distributed-safe row locking.
   * Exposed for manual triggering in tests.
   */
  async processOutbox(): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Select and lock unpublished entries, skipping any already locked by other instances
      const entries = await manager
        .createQueryBuilder(OutboxOrmEntity, 'outbox')
        .setOnLocked('skip_locked')
        .where('outbox.published_at IS NULL')
        .orderBy('outbox.created_at', 'ASC')
        .limit(OUTBOX_BATCH_SIZE)
        .getMany();

      if (entries.length === 0) {
        return;
      }

      this.logger.debug(`Processing ${String(entries.length)} outbox entries`);

      const publishedIds: string[] = [];

      for (const entry of entries) {
        try {
          this.publishEntry(entry);
          publishedIds.push(entry.id);
        } catch (error) {
          // Log error but continue processing other entries
          // Failed entries will be retried on next poll
          this.logger.error(
            `Failed to publish outbox entry ${entry.id}: ${(error as Error).message}`,
          );
        }
      }

      if (publishedIds.length > 0) {
        await manager
          .createQueryBuilder()
          .update(OutboxOrmEntity)
          .set({ publishedAt: new Date() })
          .whereInIds(publishedIds)
          .execute();

        this.logger.debug(
          `Marked ${String(publishedIds.length)} entries as published`,
        );
      }
    });
  }

  /**
   * Publish a single outbox entry to Kafka.
   */
  private publishEntry(entry: OutboxOrmEntity): void {
    const topic = OUTBOX_EVENT_TO_TOPIC[entry.eventType];

    // Use aggregateId as the Kafka message key for ordering guarantees
    this.kafkaProducer.publish(topic, entry.aggregateId, entry.payload);

    this.logger.debug(
      `Published ${entry.eventType} for ${entry.aggregateId} to ${topic}`,
    );
  }
}
