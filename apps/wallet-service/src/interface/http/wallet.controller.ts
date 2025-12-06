import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WalletService } from '../../application/services/wallet.service.js';
import { CreateWalletDto } from '../../application/dtos/create-wallet.dto.js';
import type { WalletResponseDto } from '../../application/dtos/wallet-response.dto.js';
import { GetWalletParams } from '../../application/dtos/get-wallet.dto.js';

@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWallet(@Body() dto: CreateWalletDto): Promise<WalletResponseDto> {
    return this.walletService.createWallet(dto.user_id);
  }

  @Get(':walletId')
  async getWallet(
    @Param() params: GetWalletParams,
  ): Promise<WalletResponseDto> {
    return this.walletService.getWallet(params.walletId);
  }
}
