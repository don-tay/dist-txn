import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, In } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import {
  Transfer,
  TransferStatus,
} from '../../domain/entities/transfer.entity';
import type {
  TransferRepository,
  StuckTransfer,
} from '../../domain/repositories/transfer.repository';
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
    expectedStatus: TransferStatus,
    newStatus: TransferStatus,
    failureReason?: string | null,
  ): Promise<Transfer | null> {
    // Atomic update with optimistic state machine validation
    // Only transitions from expectedStatus → newStatus are allowed
    const updateResult = await this.ormRepository
      .createQueryBuilder()
      .update(TransferOrmEntity)
      .set({
        status: newStatus,
        failureReason: failureReason ?? null,
        updatedAt: new Date(),
      })
      .where('transferId = :transferId AND status = :expectedStatus', {
        transferId,
        expectedStatus,
      })
      .execute();

    if (updateResult.affected === 0) {
      // Either transfer not found OR already in different state (idempotent)
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

  async findStuckTransfers(limit = 100): Promise<StuckTransfer[]> {
    const now = new Date();
    const stuckEntities = await this.ormRepository.find({
      where: {
        status: In([TransferStatus.PENDING, TransferStatus.DEBITED]),
        timeoutAt: LessThan(now),
      },
      take: limit,
      order: { timeoutAt: 'ASC' },
    });

    return stuckEntities.map((entity) => ({
      transfer: plainToInstance(Transfer, entity, {
        excludeExtraneousValues: true,
      }),
      receiverWalletId: entity.receiverWalletId,
      amount: entity.amount,
    }));
  }
}
