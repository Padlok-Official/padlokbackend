import { PoolClient } from 'pg';
import { EscrowTransaction } from '../../types';

export interface IEscrowRepository {
  create(client: PoolClient, data: {
    reference: string;
    buyer_id: string;
    seller_id: string;
    buyer_wallet_id: string;
    seller_wallet_id: string;
    item_description: string;
    item_photos: string[];
    price: string;
    fee?: string;
    currency?: string;
    metadata?: Record<string, unknown>;
  }): Promise<EscrowTransaction>;
  findById(id: string): Promise<EscrowTransaction | null>;
  findByReference(reference: string): Promise<EscrowTransaction | null>;
  findByIdForUpdate(client: PoolClient, id: string): Promise<EscrowTransaction | null>;
  updateStatus(client: PoolClient, id: string, status: EscrowTransaction['status'], extraFields?: Record<string, unknown>): Promise<void>;
  findByUserId(userId: string, options?: {
    role?: 'buyer' | 'seller';
    status?: EscrowTransaction['status'];
    limit?: number;
    offset?: number;
  }): Promise<{ transactions: EscrowTransaction[]; total: number }>;
  setPaystackReference(id: string, paystackReference: string): Promise<void>;
}
