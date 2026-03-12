import { PoolClient } from 'pg';
import db from '../config/database';
import { Transaction, TransactionType, TransactionStatus } from '../types';

export const TransactionModel = {
  async create(
    client: PoolClient,
    data: {
      type: TransactionType;
      status: TransactionStatus;
      reference: string;
      amount: string;
      fee?: string;
      currency?: string;
      user_id: string;
      paystack_reference?: string;
      payment_method_id?: string;
      receiver_id?: string;
      item_photos?: string[];
      item_description?: string;
      delivery_window?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<Transaction> {
    const { rows } = await client.query<Transaction>(
      `INSERT INTO transactions
        (type, status, reference, amount, fee, currency, user_id,
         paystack_reference, payment_method_id, receiver_id,
         item_photos, item_description, delivery_window, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::interval, $14)
       RETURNING *`,
      [
        data.type,
        data.status,
        data.reference,
        data.amount,
        data.fee || '0',
        data.currency || 'NGN',
        data.user_id,
        data.paystack_reference || null,
        data.payment_method_id || null,
        data.receiver_id || null,
        data.item_photos || null,
        data.item_description || null,
        data.delivery_window || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );
    return rows[0];
  },

  async findById(id: string): Promise<Transaction | null> {
    const { rows } = await db.query<Transaction>(
      `SELECT t.*, u_sender.name as sender_name, u_receiver.name as receiver_name
       FROM transactions t
       LEFT JOIN users u_sender ON t.user_id = u_sender.id
       LEFT JOIN users u_receiver ON t.receiver_id = u_receiver.id
       WHERE t.id = $1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async findByIdForUpdate(
    client: PoolClient,
    id: string
  ): Promise<Transaction | null> {
    const { rows } = await client.query<Transaction>(
      `SELECT * FROM transactions WHERE id = $1 FOR UPDATE`,
      [id]
    );
    return rows[0] ?? null;
  },

  async findByReference(reference: string): Promise<Transaction | null> {
    const { rows } = await db.query<Transaction>(
      `SELECT * FROM transactions WHERE reference = $1`,
      [reference]
    );
    return rows[0] ?? null;
  },

  async findByPaystackReference(paystackReference: string): Promise<Transaction | null> {
    const { rows } = await db.query<Transaction>(
      `SELECT * FROM transactions WHERE paystack_reference = $1`,
      [paystackReference]
    );
    return rows[0] ?? null;
  },

  async updateStatus(
    client: PoolClient,
    id: string,
    status: TransactionStatus,
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
      `UPDATE transactions SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  },

  async setPaystackReference(
    id: string,
    paystackReference: string
  ): Promise<void> {
    await db.query(
      `UPDATE transactions SET paystack_reference = $1, updated_at = NOW() WHERE id = $2`,
      [paystackReference, id]
    );
  },

  async findByUserId(
    userId: string,
    options: {
      type?: TransactionType;
      status?: TransactionStatus;
      limit?: number;
      offset?: number;
      from?: Date;
      to?: Date;
      activeToday?: boolean;
    } = {}
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const { type, status, limit = 20, offset = 0, from, to, activeToday } = options;
    const conditions: string[] = ['(t.user_id = $1 OR t.receiver_id = $1)'];
    const values: (string | number | boolean | Date | null)[] = [userId];
    let paramIndex = 2;

    if (activeToday) {
      conditions.push(`(
        t.created_at >= CURRENT_DATE OR 
        t.updated_at >= CURRENT_DATE OR 
        t.status IN ('pending', 'processing', 'initiated', 'funded', 'delivery_confirmed', 'disputed')
      )`);
    }

    if (type) {
      conditions.push(`t.type = $${paramIndex++}`);
      values.push(type);
    }
    if (status) {
      conditions.push(`t.status = $${paramIndex++}`);
      values.push(status);
    }
    if (from) {
      conditions.push(`t.created_at >= $${paramIndex++}`);
      values.push(from);
    }
    if (to) {
      conditions.push(`t.created_at <= $${paramIndex++}`);
      values.push(to);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM transactions t ${whereClause}`,
      values
    );

    const dataValues = [...values, limit, offset];
    const { rows } = await db.query<Transaction>(
      `SELECT t.*, u_sender.name as sender_name, u_receiver.name as receiver_name
       FROM transactions t
       LEFT JOIN users u_sender ON t.user_id = u_sender.id
       LEFT JOIN users u_receiver ON t.receiver_id = u_receiver.id
       ${whereClause}
       ORDER BY t.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      dataValues
    );

    return {
      transactions: rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },

  async findEscrowByParties(
    userId: string,
    options: {
      role?: 'sender' | 'receiver';
      status?: TransactionStatus;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const { role, status, limit = 20, offset = 0 } = options;
    const conditions: string[] = ["type = 'escrow'"];
    const values: (string | number | boolean | Date | null)[] = [];
    let paramIndex = 1;

    if (role === 'sender') {
      conditions.push(`user_id = $${paramIndex++}`);
      values.push(userId);
    } else if (role === 'receiver') {
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
    const { rows } = await db.query<Transaction>(
      `SELECT * FROM transactions ${whereClause}
       ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      dataValues
    );

    return {
      transactions: rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },
};
