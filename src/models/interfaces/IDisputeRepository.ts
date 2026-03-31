import { PoolClient } from 'pg';
import { Dispute } from '../../types';

export interface IDisputeRepository {
  create(client: PoolClient, data: {
    escrow_transaction_id: string;
    raised_by: string;
    reason: string;
    evidence_photos?: string[];
  }): Promise<Dispute>;
  findById(id: string): Promise<Dispute | null>;
  findByEscrowId(escrowTransactionId: string): Promise<Dispute | null>;
  updateStatus(client: PoolClient, id: string, status: Dispute['status'], adminId?: string, adminNotes?: string): Promise<void>;
  findAll(options?: {
    status?: Dispute['status'];
    limit?: number;
    offset?: number;
  }): Promise<{ disputes: Dispute[]; total: number }>;
}
