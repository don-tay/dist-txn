import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { v7 as uuidv7 } from 'uuid';
import type { TransferInitiatedEvent } from '@app/common';
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
import { KafkaProducerService } from '../../infrastructure/messaging/kafka.producer.service';

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    @Inject(TRANSFER_REPOSITORY)
    private readonly transferRepository: TransferRepository,
    private readonly kafkaProducer: KafkaProducerService,
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

    // Publish transfer.initiated event to start the saga
    const event: TransferInitiatedEvent = {
      transferId: saved.transferId,
      senderWalletId: saved.senderWalletId,
      receiverWalletId: saved.receiverWalletId,
      amount: saved.amount,
      timestamp: now.toISOString(),
    };
    this.kafkaProducer.publishTransferInitiated(event);
    this.logger.log(`Published transfer.initiated: ${saved.transferId}`);

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
