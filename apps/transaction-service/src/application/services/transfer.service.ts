import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { v7 as uuidv7 } from 'uuid';
import {
  Transfer,
  TransferStatus,
} from '../../domain/entities/transfer.entity';
import {
  TRANSFER_REPOSITORY,
  type TransferRepository,
} from '../../domain/repositories/transfer.repository';
import {
  TransferResponseDto,
  CreateTransferResponseDto,
} from '../dtos/transfer-response.dto';

@Injectable()
export class TransferService {
  constructor(
    @Inject(TRANSFER_REPOSITORY)
    private readonly transferRepository: TransferRepository,
  ) {}

  async createTransfer(
    senderWalletId: string,
    receiverWalletId: string,
    amount: number,
  ): Promise<CreateTransferResponseDto> {
    const now = new Date();
    const transfer = Transfer.create({
      transferId: uuidv7(),
      senderWalletId,
      receiverWalletId,
      amount,
      status: TransferStatus.PENDING,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    });

    const saved = await this.transferRepository.save(transfer);
    return plainToInstance(CreateTransferResponseDto, saved, {
      excludeExtraneousValues: true,
    });
  }

  async getTransfer(transferId: string): Promise<TransferResponseDto> {
    const transfer = await this.transferRepository.findById(transferId);
    if (!transfer) {
      throw new NotFoundException('Transfer not found');
    }

    return plainToInstance(TransferResponseDto, transfer, {
      excludeExtraneousValues: true,
    });
  }
}
