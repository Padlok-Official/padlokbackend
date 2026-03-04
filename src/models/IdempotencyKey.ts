import db from '../config/database';
import { IdempotencyKey } from '../types';

export const IdempotencyKeyModel = {
  async find(key: string, userId: string): Promise<IdempotencyKey | null> {
    const { rows } = await db.query<IdempotencyKey>(
      `SELECT id, key, user_id, request_path, request_body_hash, response_status, response_body, created_at, expires_at
       FROM idempotency_keys
       WHERE key = $1 AND user_id = $2 AND expires_at > NOW()`,
      [key, userId]
    );
    return rows[0] ?? null;
  },

  async create(data: {
    key: string;
    user_id: string;
    request_path: string;
    request_body_hash: string;
  }): Promise<IdempotencyKey> {
    const { rows } = await db.query<IdempotencyKey>(
      `INSERT INTO idempotency_keys (key, user_id, request_path, request_body_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.key, data.user_id, data.request_path, data.request_body_hash]
    );
    return rows[0];
  },

  async updateResponse(
    key: string,
    status: number,
    body: Record<string, unknown>
  ): Promise<void> {
    await db.query(
      `UPDATE idempotency_keys SET response_status = $1, response_body = $2 WHERE key = $3`,
      [status, JSON.stringify(body), key]
    );
  },

  async cleanExpired(): Promise<number> {
    const result = await db.query(
      `DELETE FROM idempotency_keys WHERE expires_at < NOW()`
    );
    return result.rowCount ?? 0;
  },
};
