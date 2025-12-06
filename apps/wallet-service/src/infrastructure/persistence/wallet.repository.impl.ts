import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { Wallet } from '../../domain/entities/wallet.entity';
import type { WalletRepository } from '../../domain/repositories/wallet.repository';
import { WalletOrmEntity } from './wallet.orm-entity';

@Injectable()
export class WalletRepositoryImpl implements WalletRepository {
  constructor(
    @InjectRepository(WalletOrmEntity)
    private readonly ormRepository: Repository<WalletOrmEntity>,
  ) {}

  async save(wallet: Wallet): Promise<Wallet> {
    const ormEntity = plainToInstance(WalletOrmEntity, wallet, {
      excludeExtraneousValues: true,
    });
    const saved = await this.ormRepository.save(ormEntity);
    return plainToInstance(Wallet, saved, { excludeExtraneousValues: true });
  }

  async findById(walletId: string): Promise<Wallet | null> {
    const entity = await this.ormRepository.findOne({
      where: { walletId },
    });
    return entity
      ? plainToInstance(Wallet, entity, { excludeExtraneousValues: true })
      : null;
  }

  async existsByUserId(userId: string): Promise<boolean> {
    const count = await this.ormRepository.count({
      where: { userId },
    });
    return count > 0;
  }
}
