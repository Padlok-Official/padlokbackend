import { PoolClient } from 'pg';
import { WalletTransaction } from '../../types';

export interface IWalletTransactionRepository {
  create(client: PoolClient, data: {
    wallet_id: string;
    type: WalletTransaction['type'];
    amount: string;
    fee?: string;
    balance_before: string;
    balance_after: string;
    currency?: string;
    status: WalletTransaction['status'];
    reference: string;
    paystack_reference?: string;
    escrow_transaction_id?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }): Promise<WalletTransaction>;
  findByReference(reference: string): Promise<WalletTransaction | null>;
  findById(id: string): Promise<WalletTransaction | null>;
  findByWalletId(walletId: string, options?: {
    limit?: number;
    offset?: number;
    type?: WalletTransaction['type'];
    status?: WalletTransaction['status'];
    from?: Date;
    to?: Date;
  }): Promise<{ transactions: WalletTransaction[]; total: number }>;
  updateStatus(client: PoolClient, id: string, status: WalletTransaction['status']): Promise<void>;
}
