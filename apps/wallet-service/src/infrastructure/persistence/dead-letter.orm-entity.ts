import { Entity, PrimaryColumn, Column, Index } from 'typeorm';
import { Expose } from 'class-transformer';
import { DeadLetterStatus } from '../../domain/entities/dead-letter.entity';

@Entity('dead_letter_queue')
export class DeadLetterOrmEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  @Expose()
  id!: string;

  @Column({ name: 'original_topic', type: 'varchar', length: 255 })
  @Expose()
  originalTopic!: string;

  @Column({ name: 'original_payload', type: 'jsonb' })
  @Expose()
  originalPayload!: Record<string, unknown>;

  @Column({ name: 'error_message', type: 'text' })
  @Expose()
  errorMessage!: string;

  @Column({ name: 'error_stack', type: 'text', nullable: true })
  @Expose()
  errorStack!: string | null;

  @Column({ name: 'attempt_count', type: 'int' })
  @Expose()
  attemptCount!: number;

  @Column({ name: 'first_attempt_at', type: 'timestamptz' })
  @Expose()
  firstAttemptAt!: Date;

  @Column({ name: 'last_attempt_at', type: 'timestamptz' })
  @Expose()
  lastAttemptAt!: Date;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 20,
    default: DeadLetterStatus.PENDING,
  })
  @Index()
  @Expose()
  status!: DeadLetterStatus;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  @Expose()
  processedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  @Index()
  @Expose()
  createdAt!: Date;
}
