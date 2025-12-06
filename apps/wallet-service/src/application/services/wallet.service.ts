import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { v7 as uuidv7 } from 'uuid';
import { Wallet } from '../../domain/entities/wallet.entity.js';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
} from '../../domain/repositories/wallet.repository.js';
import { WalletResponseDto } from '../dtos/create-wallet.dto.js';

@Injectable()
export class WalletService {
  constructor(
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepository: WalletRepository,
  ) {}

  async createWallet(userId: string): Promise<WalletResponseDto> {
    const exists = await this.walletRepository.existsByUserId(userId);
    if (exists) {
      throw new ConflictException('Wallet already exists for this user');
    }

    const now = new Date();
    const wallet = plainToInstance(
      Wallet,
      {
        walletId: uuidv7(),
        userId,
        balance: 0,
        createdAt: now,
        updatedAt: now,
      },
      { excludeExtraneousValues: true },
    );

    const saved = await this.walletRepository.save(wallet);
    return this.toResponseDto(saved, false);
  }

  async getWallet(walletId: string): Promise<WalletResponseDto> {
    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return this.toResponseDto(wallet, true);
  }

  private toResponseDto(
    wallet: Wallet,
    includeUpdatedAt: boolean,
  ): WalletResponseDto {
    const plain = {
      wallet_id: wallet.walletId,
      user_id: wallet.userId,
      balance: wallet.balance,
      created_at: wallet.createdAt.toISOString(),
      ...(includeUpdatedAt && { updated_at: wallet.updatedAt.toISOString() }),
    };

    return plainToInstance(WalletResponseDto, plain, {
      excludeExtraneousValues: true,
    });
  }
}
