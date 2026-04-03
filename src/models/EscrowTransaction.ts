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
      item_title: string;
      item_description?: string;
      item_photos: string[];
      price: string;
      fee?: string;
      currency?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<EscrowTransaction> {
    const metadata = {
      ...(data.metadata || {}),
      sender_wallet_id: data.buyer_wallet_id,
      receiver_wallet_id: data.seller_wallet_id,
    };

    const { rows } = await client.query<EscrowTransaction>(
      `INSERT INTO transactions
        (type, status, reference, amount, fee, currency, user_id,
         receiver_id, item_title, item_description, item_photos, metadata)
       VALUES ('escrow', 'initiated', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        data.reference,
        data.price,
        data.fee || '0',
        data.currency || 'GHS',
        data.buyer_id,
        data.seller_id,
        data.item_title,
        data.item_description || null,
        data.item_photos,
        JSON.stringify(metadata),
      ]
    );
    return rows[0];
  },

  async findById(id: string): Promise<EscrowTransaction | null> {
    const { rows } = await db.query<EscrowTransaction>(
      `SELECT * FROM transactions WHERE id = $1 AND type = 'escrow'`,
      [id]
    );
    return rows[0] ?? null;
  },

  async findByReference(reference: string): Promise<EscrowTransaction | null> {
    const { rows } = await db.query<EscrowTransaction>(
      `SELECT * FROM transactions WHERE reference = $1 AND type = 'escrow'`,
      [reference]
    );
    return rows[0] ?? null;
  },

  async findByIdForUpdate(
    client: PoolClient,
    id: string
  ): Promise<EscrowTransaction | null> {
    const { rows } = await client.query<EscrowTransaction>(
      `SELECT * FROM transactions WHERE id = $1 AND type = 'escrow' FOR UPDATE`,
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
      `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = $${paramIndex} AND type = 'escrow'`,
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
    const conditions: string[] = ["type = 'escrow'"];
    const values: (string | number | boolean | Date | null)[] = [];
    let paramIndex = 1;

    if (role === 'buyer') {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(userId);
    } else if (role === 'seller') {
      conditions.push(`receiver_id = $${paramIndex++}`);
      values.push(userId);
    } else {
      conditions.push(`(user_id = $${paramIndex} OR receiver_id = $${paramIndex})`);
      paramIndex++;
      values.push(userId);
    }

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM transactions ${whereClause}`,
      values
    );

    const dataValues = [...values, limit, offset];
    const { rows } = await db.query<EscrowTransaction>(
      `SELECT * FROM transactions ${whereClause}
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
      `UPDATE transactions SET paystack_reference = $1, updated_at = NOW() WHERE id = $2 AND type = 'escrow'`,
      [paystackReference, id]
    );
  },
};
