import { PoolClient } from 'pg';
import db from '../config/database';
import { WalletTransaction } from '../types';

export const WalletTransactionModel = {
  async create(
    client: PoolClient,
    data: {
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
    }
  ): Promise<WalletTransaction> {
    const { rows } = await client.query<WalletTransaction>(
      `INSERT INTO wallet_transactions
        (wallet_id, type, amount, fee, balance_before, balance_after, currency,
         status, reference, paystack_reference, escrow_transaction_id, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        data.wallet_id,
        data.type,
        data.amount,
        data.fee || '0',
        data.balance_before,
        data.balance_after,
        data.currency || 'GHS',
        data.status,
        data.reference,
        data.paystack_reference || null,
        data.escrow_transaction_id || null,
        data.description || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );
    return rows[0];
  },

  async findByReference(reference: string): Promise<WalletTransaction | null> {
    const { rows } = await db.query<WalletTransaction>(
      `SELECT * FROM wallet_transactions WHERE reference = $1`,
      [reference]
    );
    return rows[0] ?? null;
  },

  async findById(id: string): Promise<WalletTransaction | null> {
    const { rows } = await db.query<WalletTransaction>(
      `SELECT * FROM wallet_transactions WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async findByWalletId(
    walletId: string,
    options: {
      limit?: number;
      offset?: number;
      type?: WalletTransaction['type'];
      status?: WalletTransaction['status'];
      from?: Date;
      to?: Date;
    } = {}
  ): Promise<{ transactions: WalletTransaction[]; total: number }> {
    const { limit = 20, offset = 0, type, status, from, to } = options;
    const conditions: string[] = ['wallet_id = $1'];
    const values: (string | number | boolean | Date | null)[] = [walletId];
    let paramIndex = 2;

    if (type) {
      conditions.push(`type = $${paramIndex++}`);
      values.push(type);
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (from) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(from);
    }
    if (to) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(to);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM wallet_transactions ${whereClause}`,
      values
    );

    const dataValues = [...values, limit, offset];
    const { rows } = await db.query<WalletTransaction>(
      `SELECT * FROM wallet_transactions ${whereClause}
       ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      dataValues
    );

    return {
      transactions: rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async updateStatus(
    client: PoolClient,
    id: string,
    status: WalletTransaction['status']
  ): Promise<void> {
    await client.query(
      `UPDATE wallet_transactions SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id]
    );
  },
};
