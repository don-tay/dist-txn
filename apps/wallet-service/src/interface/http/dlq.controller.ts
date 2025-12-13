import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  NotFoundException,
  Logger,
  Inject,
  HttpCode,
  HttpStatus,
  ParseEnumPipe,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { DlqService } from '../../infrastructure/messaging/dlq.service';
import {
  DeadLetterStatus,
  DeadLetter,
} from '../../domain/entities/dead-letter.entity';
import {
  WALLET_REPOSITORY,
  type WalletRepository,
} from '../../domain/repositories/wallet.repository';
import { KafkaProducerService } from '../../infrastructure/messaging/kafka.producer.service';
import {
  KAFKA_TOPICS,
  LedgerEntryType,
  generateRefundTransactionId,
  type WalletCreditFailedEvent,
  type WalletRefundedEvent,
} from '@app/common';
import { DlqEntryResponseDto } from '../../application/dtos/dlq-response.dto';

/**
 * Admin controller for Dead Letter Queue operations.
 */
@Controller('admin/dlq')
export class DlqController {
  private readonly logger = new Logger(DlqController.name);

  constructor(
    private readonly dlqService: DlqService,
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepository: WalletRepository,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  /**
   * List all DLQ entries.
   * GET /admin/dlq
   * GET /admin/dlq?status=PENDING
   */
  @Get()
  async listAll(
    @Query('status', new ParseEnumPipe(DeadLetterStatus, { optional: true }))
    status?: DeadLetterStatus,
  ): Promise<DlqEntryResponseDto[]> {
    const entries = await this.dlqService.getAll(status);
    return entries.map((entry) =>
      plainToInstance(DlqEntryResponseDto, entry, {
        excludeExtraneousValues: true,
      }),
    );
  }

  /**
   * Get a specific DLQ entry by ID.
   * GET /admin/dlq/:id
   */
  @Get(':id')
  async getById(@Param('id') id: string): Promise<DlqEntryResponseDto> {
    const entry = await this.dlqService.getById(id);
    if (!entry) {
      throw new NotFoundException(`DLQ entry not found: ${id}`);
    }
    return plainToInstance(DlqEntryResponseDto, entry, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Replay a DLQ entry (re-attempt the failed operation).
   * POST /admin/dlq/:id/replay
   */
  @Post(':id/replay')
  @HttpCode(HttpStatus.OK)
  async replay(
    @Param('id') id: string,
  ): Promise<{ success: boolean; message: string }> {
    const entry = await this.dlqService.getById(id);
    if (!entry) {
      throw new NotFoundException(`DLQ entry not found: ${id}`);
    }

    // Skip replay if already processed
    if (entry.status === DeadLetterStatus.PROCESSED) {
      return { success: true, message: 'Entry already processed' };
    }

    this.logger.log(
      `Replaying DLQ entry: ${id}, topic: ${entry.originalTopic}`,
    );

    try {
      // Handle replay based on the original topic
      await this.handleReplay(entry);
      await this.dlqService.markProcessed(id);
      return { success: true, message: 'Replay successful' };
    } catch (error) {
      await this.dlqService.markFailed(id);
      const errorMessage = (error as Error).message;
      this.logger.error(`Replay failed for DLQ entry ${id}: ${errorMessage}`);
      return { success: false, message: `Replay failed: ${errorMessage}` };
    }
  }

  /**
   * Handle replay based on the original topic type.
   */
  private async handleReplay(entry: DeadLetter): Promise<void> {
    switch (entry.originalTopic) {
      case KAFKA_TOPICS.WALLET_CREDIT_FAILED:
        await this.replayCreditFailedRefund(
          entry.originalPayload as unknown as WalletCreditFailedEvent,
        );
        break;
      default:
        throw new Error(`Unsupported topic for replay: ${entry.originalTopic}`);
    }
  }

  /**
   * Replay a failed refund from a credit-failed event.
   */
  private async replayCreditFailedRefund(
    event: WalletCreditFailedEvent,
  ): Promise<void> {
    const refundTransactionId = generateRefundTransactionId(event.transferId);

    const result = await this.walletRepository.updateBalanceWithLedger(
      event.senderWalletId,
      refundTransactionId,
      event.amount,
      LedgerEntryType.REFUND,
    );

    // Publish refund success event
    const refundedEvent: WalletRefundedEvent = {
      transferId: event.transferId,
      walletId: event.senderWalletId,
      amount: event.amount,
      timestamp: new Date().toISOString(),
    };
    this.kafkaProducer.publishWalletRefunded(refundedEvent);

    this.logger.log(
      `Refund replay successful: wallet=${event.senderWalletId}, ` +
        `newBalance=${String(result.wallet.balance)}`,
    );
  }
}
