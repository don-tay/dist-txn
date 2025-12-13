import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  DeadLetter,
  DeadLetterStatus,
} from '../../domain/entities/dead-letter.entity';
import type { DeadLetterRepository } from '../../domain/repositories/dead-letter.repository';
import { DeadLetterOrmEntity } from './dead-letter.orm-entity';

@Injectable()
export class DeadLetterRepositoryImpl implements DeadLetterRepository {
  constructor(
    @InjectRepository(DeadLetterOrmEntity)
    private readonly ormRepository: Repository<DeadLetterOrmEntity>,
  ) {}

  async save(deadLetter: DeadLetter): Promise<DeadLetter> {
    const ormEntity = plainToInstance(DeadLetterOrmEntity, deadLetter, {
      excludeExtraneousValues: true,
    });
    const saved = await this.ormRepository.save(ormEntity);
    return plainToInstance(DeadLetter, saved, {
      excludeExtraneousValues: true,
    });
  }

  async findById(id: string): Promise<DeadLetter | null> {
    const entity = await this.ormRepository.findOne({ where: { id } });
    return entity
      ? plainToInstance(DeadLetter, entity, { excludeExtraneousValues: true })
      : null;
  }

  async findAll(status?: DeadLetterStatus): Promise<DeadLetter[]> {
    const query = this.ormRepository
      .createQueryBuilder('dlq')
      .orderBy('dlq.created_at', 'DESC');

    if (status) {
      query.where('dlq.status = :status', { status });
    }

    const entities = await query.getMany();
    return entities.map((entity) =>
      plainToInstance(DeadLetter, entity, { excludeExtraneousValues: true }),
    );
  }

  async updateStatus(
    id: string,
    status: DeadLetterStatus,
    processedAt?: Date,
  ): Promise<DeadLetter | null> {
    const result = await this.ormRepository.update(
      { id },
      { status, ...(processedAt ? { processedAt } : {}) },
    );
    if (result.affected === 0) {
      return null;
    }

    return this.findById(id);
  }
}
