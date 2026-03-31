import { PoolClient } from 'pg';
import { Transaction, TransactionType, TransactionStatus } from '../../types';

export interface ITransactionRepository {
  create(client: PoolClient, data: {
    type: TransactionType;
    status: TransactionStatus;
    reference: string;
    amount: string;
    user_id: string;
    fee?: string;
    paystack_reference?: string;
    payment_method_id?: string;
    receiver_id?: string;
    item_description?: string;
    item_photos?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<Transaction>;
  findById(id: string): Promise<Transaction | null>;
  findByReference(reference: string): Promise<Transaction | null>;
  findByUserId(userId: string, filters?: {
    type?: TransactionType;
    status?: TransactionStatus;
    limit?: number;
    offset?: number;
    from?: Date;
    to?: Date;
    activeToday?: boolean;
  }): Promise<{ transactions: Transaction[]; total: number }>;
  updateStatus(client: PoolClient, id: string, status: TransactionStatus, data?: Record<string, unknown>): Promise<void>;
  setPaystackReference(id: string, reference: string): Promise<void>;
}
