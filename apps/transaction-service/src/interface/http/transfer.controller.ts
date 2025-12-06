import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TransferService } from '../../application/services/transfer.service';
import { CreateTransferDto } from '../../application/dtos/create-transfer.dto';
import type {
  TransferResponseDto,
  CreateTransferResponseDto,
} from '../../application/dtos/transfer-response.dto';
import { GetTransferParams } from '../../application/dtos/get-transfer.dto';

@Controller('transfers')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async createTransfer(
    @Body() dto: CreateTransferDto,
  ): Promise<CreateTransferResponseDto> {
    return this.transferService.createTransfer(
      dto.senderWalletId,
      dto.receiverWalletId,
      dto.amount,
    );
  }

  @Get(':transferId')
  async getTransfer(
    @Param() params: GetTransferParams,
  ): Promise<TransferResponseDto> {
    return this.transferService.getTransfer(params.transferId);
  }
}
