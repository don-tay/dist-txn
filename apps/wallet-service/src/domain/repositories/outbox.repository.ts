import type { OutboxEntry, CreateOutboxEntry } from '@app/common';

export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');

export interface OutboxRepository {
  /**
   * Save a new outbox entry within the current transaction.
   * This should be called within the same transaction as the domain update.
   */
  save(entry: CreateOutboxEntry): Promise<OutboxEntry>;

  /**
   * Find unpublished outbox entries ordered by creation time.
   * Used by the background publisher to poll for events to publish.
   *
   * @param limit - Maximum number of entries to return
   * @returns Array of unpublished outbox entries
   */
  findUnpublished(limit: number): Promise<OutboxEntry[]>;

  /**
   * Mark an outbox entry as published.
   * Called after successful Kafka publication.
   *
   * @param id - The outbox entry ID
   * @returns true if marked, false if not found or already published
   */
  markAsPublished(id: string): Promise<boolean>;

  /**
   * Mark multiple outbox entries as published in a batch.
   * More efficient for bulk publishing.
   *
   * @param ids - Array of outbox entry IDs
   * @returns Number of entries marked as published
   */
  markManyAsPublished(ids: string[]): Promise<number>;
}
