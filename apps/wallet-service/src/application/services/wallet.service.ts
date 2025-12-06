import {
  Injectable,
  Inject,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { v7 as uuidv7 } from 'uuid';
import { Wallet } from '../../domain/entities/wallet.entity';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
} from '../../domain/repositories/wallet.repository';
import {
  WalletResponseDto,
  CreateWalletResponseDto,
} from '../dtos/wallet-response.dto';

@Injectable()
export class WalletService {
  constructor(
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepository: WalletRepository,
  ) {}

  async createWallet(userId: string): Promise<CreateWalletResponseDto> {
    const exists = await this.walletRepository.existsByUserId(userId);
    if (exists) {
      throw new ConflictException('Wallet already exists for this user');
    }

    const now = new Date();
    const wallet = Wallet.create({
      walletId: uuidv7(),
      userId,
      balance: 0,
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.walletRepository.save(wallet);
    return plainToInstance(CreateWalletResponseDto, saved, {
      excludeExtraneousValues: true,
    });
  }

  async getWallet(walletId: string): Promise<WalletResponseDto> {
    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return plainToInstance(WalletResponseDto, wallet, {
      excludeExtraneousValues: true,
    });
  }
}
