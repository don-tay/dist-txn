import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { v7 as uuidv7 } from 'uuid';
import { OutboxEntry, CreateOutboxEntry } from '@app/common';
import type { OutboxRepository } from '../../domain/repositories/outbox.repository';
import { OutboxOrmEntity } from './outbox.orm-entity';

@Injectable()
export class OutboxRepositoryImpl implements OutboxRepository {
  constructor(
    @InjectRepository(OutboxOrmEntity)
    private readonly ormRepository: Repository<OutboxOrmEntity>,
  ) {}

  async save(entry: CreateOutboxEntry): Promise<OutboxEntry> {
    const now = new Date();
    const ormEntity = this.ormRepository.create({
      id: uuidv7(),
      aggregateType: entry.aggregateType,
      aggregateId: entry.aggregateId,
      eventType: entry.eventType,
      payload: entry.payload,
      createdAt: now,
      publishedAt: null,
    });
    const saved = await this.ormRepository.save(ormEntity);
    return this.toOutboxEntry(saved);
  }

  async findUnpublished(limit: number): Promise<OutboxEntry[]> {
    const entities = await this.ormRepository.find({
      where: { publishedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: limit,
    });
    return entities.map((entity) => this.toOutboxEntry(entity));
  }

  async markAsPublished(id: string): Promise<boolean> {
    const result = await this.ormRepository.update(
      { id, publishedAt: IsNull() },
      { publishedAt: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }

  async markManyAsPublished(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const result = await this.ormRepository.update(
      { id: In(ids), publishedAt: IsNull() },
      { publishedAt: new Date() },
    );
    return result.affected ?? 0;
  }

  private toOutboxEntry(entity: OutboxOrmEntity): OutboxEntry {
    return plainToInstance(
      OutboxEntry,
      {
        id: entity.id,
        aggregateType: entity.aggregateType,
        aggregateId: entity.aggregateId,
        eventType: entity.eventType,
        payload: entity.payload,
        createdAt: entity.createdAt,
        publishedAt: entity.publishedAt,
      },
      { excludeExtraneousValues: false },
    );
  }
}
