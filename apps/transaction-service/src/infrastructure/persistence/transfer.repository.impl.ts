import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { Transfer } from '../../domain/entities/transfer.entity';
import type { TransferRepository } from '../../domain/repositories/transfer.repository';
import { TransferOrmEntity } from './transfer.orm-entity';

@Injectable()
export class TransferRepositoryImpl implements TransferRepository {
  constructor(
    @InjectRepository(TransferOrmEntity)
    private readonly ormRepository: Repository<TransferOrmEntity>,
  ) {}

  async save(transfer: Transfer): Promise<Transfer> {
    const ormEntity = plainToInstance(TransferOrmEntity, transfer, {
      excludeExtraneousValues: true,
    });
    const saved = await this.ormRepository.save(ormEntity);
    return plainToInstance(Transfer, saved, { excludeExtraneousValues: true });
  }

  async findById(transferId: string): Promise<Transfer | null> {
    const entity = await this.ormRepository.findOne({
      where: { transferId },
    });
    return entity
      ? plainToInstance(Transfer, entity, { excludeExtraneousValues: true })
      : null;
  }
}
