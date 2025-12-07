import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  Transfer,
  TransferStatus,
} from '../../domain/entities/transfer.entity';
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

  async updateStatus(
    transferId: string,
    status: TransferStatus,
    failureReason?: string | null,
  ): Promise<Transfer | null> {
    // Use atomic update to avoid race conditions between concurrent event handlers
    const updateResult = await this.ormRepository.update(
      { transferId },
      {
        status,
        failureReason: failureReason ?? null,
        updatedAt: new Date(),
      },
    );

    if (updateResult.affected === 0) {
      return null;
    }

    const updatedEntity = await this.ormRepository.findOne({
      where: { transferId },
    });
    return updatedEntity
      ? plainToInstance(Transfer, updatedEntity, {
          excludeExtraneousValues: true,
        })
      : null;
  }
}
