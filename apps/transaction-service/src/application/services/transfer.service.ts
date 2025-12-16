import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { v7 as uuidv7 } from 'uuid';
import {
  OutboxAggregateType,
  OutboxEventType,
  type TransferInitiatedEvent,
} from '@app/common';
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
import { TransferOrmEntity } from '../../infrastructure/persistence/transfer.orm-entity';
import { OutboxOrmEntity } from '../../infrastructure/persistence/outbox.orm-entity';

/** Default saga timeout in milliseconds (60 seconds for learning) */
const DEFAULT_SAGA_TIMEOUT_MS = 60_000;

@Injectable()
export class TransferService {
  private readonly sagaTimeoutMs: number;

  constructor(
    @Inject(TRANSFER_REPOSITORY)
    private readonly transferRepository: TransferRepository,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    this.sagaTimeoutMs = this.configService.get<number>(
      'SAGA_TIMEOUT_MS',
      DEFAULT_SAGA_TIMEOUT_MS,
    );
  }

  async createTransfer(
    senderWalletId: string,
    receiverWalletId: string,
    amount: number,
  ): Promise<CreateTransferResponseDto> {
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + this.sagaTimeoutMs);
    const transferId = uuidv7();

    // Build the event payload
    const event: TransferInitiatedEvent = {
      transferId,
      senderWalletId,
      receiverWalletId,
      amount,
      timestamp: now.toISOString(),
    };

    // Atomic transaction: save transfer + outbox entry
    const saved = await this.dataSource.transaction(async (manager) => {
      const transferRepo = manager.getRepository(TransferOrmEntity);
      const outboxRepo = manager.getRepository(OutboxOrmEntity);

      // Save transfer
      const transferEntity = transferRepo.create({
        transferId,
        senderWalletId,
        receiverWalletId,
        amount,
        status: TransferStatus.PENDING,
        failureReason: null,
        timeoutAt,
        createdAt: now,
        updatedAt: now,
      });
      const savedTransfer = await transferRepo.save(transferEntity);

      // Save outbox entry for transfer.initiated event
      const outboxEntry = outboxRepo.create({
        id: uuidv7(),
        aggregateType: OutboxAggregateType.TRANSFER,
        aggregateId: transferId,
        eventType: OutboxEventType.TRANSFER_INITIATED,
        payload: event as unknown as Record<string, unknown>,
        createdAt: now,
        publishedAt: null,
      });
      await outboxRepo.save(outboxEntry);

      return savedTransfer;
    });

    return plainToInstance(
      CreateTransferResponseDto,
      plainToInstance(Transfer, saved, { excludeExtraneousValues: true }),
      { excludeExtraneousValues: true },
    );
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
