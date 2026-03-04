import { PoolClient } from 'pg';
import db from '../config/database';
import { EscrowTransaction } from '../types';

export const EscrowTransactionModel = {
  async create(
    client: PoolClient,
    data: {
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
    }
  ): Promise<EscrowTransaction> {
    const { rows } = await client.query<EscrowTransaction>(
      `INSERT INTO escrow_transactions
        (reference, buyer_id, seller_id, buyer_wallet_id, seller_wallet_id,
         item_description, item_photos, price, fee, currency, metadata, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'initiated')
       RETURNING *`,
      [
        data.reference,
        data.buyer_id,
        data.seller_id,
        data.buyer_wallet_id,
        data.seller_wallet_id,
        data.item_description,
        data.item_photos,
        data.price,
        data.fee || '0',
        data.currency || 'NGN',
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );
    return rows[0];
  },

  async findById(id: string): Promise<EscrowTransaction | null> {
    const { rows } = await db.query<EscrowTransaction>(
      `SELECT * FROM escrow_transactions WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async findByReference(reference: string): Promise<EscrowTransaction | null> {
    const { rows } = await db.query<EscrowTransaction>(
      `SELECT * FROM escrow_transactions WHERE reference = $1`,
      [reference]
    );
    return rows[0] ?? null;
  },

  async findByIdForUpdate(
    client: PoolClient,
    id: string
  ): Promise<EscrowTransaction | null> {
    const { rows } = await client.query<EscrowTransaction>(
      `SELECT * FROM escrow_transactions WHERE id = $1 FOR UPDATE`,
      [id]
    );
    return rows[0] ?? null;
  },

  async updateStatus(
    client: PoolClient,
    id: string,
    status: EscrowTransaction['status'],
    extraFields?: Record<string, unknown>
  ): Promise<void> {
    const setClauses = ['status = $1', 'updated_at = NOW()'];
    const values: (string | number | boolean | Date | null)[] = [status];
    let paramIndex = 2;

    if (extraFields) {
      for (const [key, value] of Object.entries(extraFields)) {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(value as string | number | boolean | Date | null);
        paramIndex++;
      }
    }

    values.push(id);
    await client.query(
      `UPDATE escrow_transactions SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  },

  async findByUserId(
    userId: string,
    options: {
      role?: 'buyer' | 'seller';
      status?: EscrowTransaction['status'];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ transactions: EscrowTransaction[]; total: number }> {
    const { role, status, limit = 20, offset = 0 } = options;
    const conditions: string[] = [];
    const values: (string | number | boolean | Date | null)[] = [];
    let paramIndex = 1;

    if (role === 'buyer') {
      conditions.push(`buyer_id = $${paramIndex++}`);
      values.push(userId);
    } else if (role === 'seller') {
      conditions.push(`seller_id = $${paramIndex++}`);
      values.push(userId);
    } else {
      conditions.push(`(buyer_id = $${paramIndex} OR seller_id = $${paramIndex})`);
      paramIndex++;
      values.push(userId);
    }

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM escrow_transactions ${whereClause}`,
      values
    );

    const dataValues = [...values, limit, offset];
    const { rows } = await db.query<EscrowTransaction>(
      `SELECT * FROM escrow_transactions ${whereClause}
       ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      dataValues
    );

    return {
      transactions: rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async setPaystackReference(
    id: string,
    paystackReference: string
  ): Promise<void> {
    await db.query(
      `UPDATE escrow_transactions SET paystack_reference = $1, updated_at = NOW() WHERE id = $2`,
      [paystackReference, id]
    );
  },
};
