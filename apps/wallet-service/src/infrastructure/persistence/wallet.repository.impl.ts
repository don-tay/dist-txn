import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { v7 as uuidv7 } from 'uuid';
import { LedgerEntryType, type CreateOutboxEntry } from '@app/common';
import { Wallet } from '../../domain/entities/wallet.entity';
import { WalletLedgerEntry } from '../../domain/entities/wallet-ledger-entry.entity';
import type {
  WalletRepository,
  DebitCreditResult,
} from '../../domain/repositories/wallet.repository';
import { WalletOrmEntity } from './wallet.orm-entity';
import { WalletLedgerEntryOrmEntity } from './wallet-ledger-entry.orm-entity';
import { OutboxOrmEntity } from './outbox.orm-entity';

@Injectable()
export class WalletRepositoryImpl implements WalletRepository {
  constructor(
    @InjectRepository(WalletOrmEntity)
    private readonly ormRepository: Repository<WalletOrmEntity>,
    @InjectRepository(WalletLedgerEntryOrmEntity)
    private readonly ledgerRepository: Repository<WalletLedgerEntryOrmEntity>,
    private readonly dataSource: DataSource,
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

  async updateBalanceWithLedger(
    walletId: string,
    transactionId: string,
    amount: number,
    type: LedgerEntryType,
    outboxEntry?: CreateOutboxEntry,
  ): Promise<DebitCreditResult> {
    return this.dataSource.transaction(async (manager) => {
      const walletRepo = manager.getRepository(WalletOrmEntity);
      const ledgerRepo = manager.getRepository(WalletLedgerEntryOrmEntity);
      const outboxRepo = manager.getRepository(OutboxOrmEntity);

      // Check for existing ledger entry (idempotency)
      const existingEntry = await ledgerRepo.findOne({
        where: { walletId, transactionId },
      });
      if (existingEntry) {
        const wallet = await walletRepo.findOne({ where: { walletId } });
        return {
          wallet: plainToInstance(Wallet, wallet, {
            excludeExtraneousValues: true,
          }),
          ledgerEntry: plainToInstance(WalletLedgerEntry, existingEntry, {
            excludeExtraneousValues: true,
          }),
          isDuplicate: true,
        };
      }

      // Atomic balance update using relative update (optimistic, no retry)
      // PostgreSQL row-level locking during UPDATE ensures correctness
      const isDebit = type === LedgerEntryType.DEBIT;
      const updateResult = await walletRepo
        .createQueryBuilder()
        .update(WalletOrmEntity)
        .set({
          balance: () =>
            isDebit ? 'balance - :amountValue' : 'balance + :amountValue',
          updatedAt: new Date(),
        })
        .setParameter('amountValue', amount)
        .where(
          isDebit
            ? 'wallet_id = :walletId AND balance >= :amount'
            : 'wallet_id = :walletId',
          { walletId, amount },
        )
        .execute();

      if (updateResult.affected !== 1) {
        // Distinguish: wallet not found vs insufficient balance
        const wallet = await walletRepo.findOne({ where: { walletId } });
        if (!wallet) {
          throw new Error(`Wallet not found: ${walletId}`);
        }
        throw new Error(
          `Insufficient balance: current=${String(wallet.balance)}, required=${String(amount)}`,
        );
      }

      // Create ledger entry for audit trail
      const ledgerEntry = ledgerRepo.create({
        entryId: uuidv7(),
        walletId,
        transactionId,
        type,
        amount,
        createdAt: new Date(),
      });
      const savedEntry = await ledgerRepo.save(ledgerEntry);

      // Write outbox entry in same transaction if provided
      if (outboxEntry) {
        const outbox = outboxRepo.create({
          id: uuidv7(),
          aggregateType: outboxEntry.aggregateType,
          aggregateId: outboxEntry.aggregateId,
          eventType: outboxEntry.eventType,
          payload: outboxEntry.payload,
          createdAt: new Date(),
          publishedAt: null,
        });
        await outboxRepo.save(outbox);
      }

      // Fetch updated wallet for return
      const updatedWallet = await walletRepo.findOne({
        where: { walletId },
      });

      if (!updatedWallet) {
        throw new Error(`Wallet disappeared after update: ${walletId}`);
      }

      return {
        wallet: plainToInstance(Wallet, updatedWallet, {
          excludeExtraneousValues: true,
        }),
        ledgerEntry: plainToInstance(WalletLedgerEntry, savedEntry, {
          excludeExtraneousValues: true,
        }),
        isDuplicate: false,
      };
    });
  }

  async findLedgerEntry(
    walletId: string,
    transactionId: string,
  ): Promise<WalletLedgerEntry | null> {
    const entry = await this.ledgerRepository.findOne({
      where: { walletId, transactionId },
    });
    return entry
      ? plainToInstance(WalletLedgerEntry, entry, {
          excludeExtraneousValues: true,
        })
      : null;
  }
}
