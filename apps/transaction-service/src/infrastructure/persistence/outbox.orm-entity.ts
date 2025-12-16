import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { Expose } from 'class-transformer';
import { OutboxAggregateType, OutboxEventType } from '@app/common';

@Entity('outbox')
export class OutboxOrmEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  @Expose()
  id!: string;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 255 })
  @Expose()
  aggregateType!: OutboxAggregateType;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  @Expose()
  aggregateId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 255 })
  @Expose()
  eventType!: OutboxEventType;

  @Column({ name: 'payload', type: 'jsonb' })
  @Expose()
  payload!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'timestamptz' })
  @Index()
  @Expose()
  createdAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  @Expose()
  publishedAt!: Date | null;
}
