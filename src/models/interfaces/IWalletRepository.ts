import { PoolClient } from 'pg';
import { Wallet, WalletWithPin } from '../../types';

export interface IWalletRepository {
  findByUserId(userId: string): Promise<Wallet | null>;
  findById(walletId: string): Promise<Wallet | null>;
  findByUserIdWithPin(userId: string): Promise<WalletWithPin | null>;
  create(userId: string, currency?: string): Promise<void>;
  setPin(walletId: string, pinHash: string): Promise<void>;
  incrementPinAttempts(walletId: string): Promise<number>;
  lockPin(walletId: string, lockedUntil: Date): Promise<void>;
  resetPinAttempts(walletId: string): Promise<void>;
  creditBalance(client: PoolClient, walletId: string, amount: string): Promise<{ balance_before: string; balance_after: string }>;
  debitBalance(client: PoolClient, walletId: string, amount: string): Promise<{ balance_before: string; balance_after: string }>;
  creditEscrow(client: PoolClient, walletId: string, amount: string): Promise<void>;
  debitEscrow(client: PoolClient, walletId: string, amount: string): Promise<void>;
  resetSpendingIfNeeded(client: PoolClient, walletId: string): Promise<void>;
  checkSpendingLimits(walletId: string, amount: string): Promise<{ allowed: boolean; reason?: string }>;
  updateLimits(walletId: string, daily?: string, monthly?: string): Promise<void>;
  updateStatus(walletId: string, status: 'active' | 'frozen' | 'suspended'): Promise<void>;
}
