import { Expose, Transform } from 'class-transformer';

/**
 * Response DTO for DLQ entries.
 */
export class DlqEntryResponseDto {
  @Expose()
  id!: string;

  @Expose()
  originalTopic!: string;

  @Expose()
  originalPayload!: Record<string, unknown>;

  @Expose()
  errorMessage!: string;

  @Expose()
  attemptCount!: number;

  @Expose()
  status!: string;

  @Expose()
  @Transform(
    ({ value }: { value: Date | null }) => value?.toISOString() ?? null,
  )
  processedAt!: string | null;

  @Expose()
  @Transform(({ value }: { value: Date }) => value.toISOString())
  createdAt!: string;
}
