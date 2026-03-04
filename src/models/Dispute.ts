import { PoolClient } from 'pg';
import db from '../config/database';
import { Dispute } from '../types';

export const DisputeModel = {
  async create(
    client: PoolClient,
    data: {
      escrow_transaction_id: string;
      raised_by: string;
      reason: string;
      evidence_photos?: string[];
    }
  ): Promise<Dispute> {
    const { rows } = await client.query<Dispute>(
      `INSERT INTO disputes (escrow_transaction_id, raised_by, reason, evidence_photos, status)
       VALUES ($1, $2, $3, $4, 'open')
       RETURNING *`,
      [
        data.escrow_transaction_id,
        data.raised_by,
        data.reason,
        data.evidence_photos || [],
      ]
    );
    return rows[0];
  },

  async findById(id: string): Promise<Dispute | null> {
    const { rows } = await db.query<Dispute>(
      `SELECT * FROM disputes WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async findByEscrowId(escrowTransactionId: string): Promise<Dispute | null> {
    const { rows } = await db.query<Dispute>(
      `SELECT * FROM disputes WHERE escrow_transaction_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [escrowTransactionId]
    );
    return rows[0] ?? null;
  },

  async updateStatus(
    client: PoolClient,
    id: string,
    status: Dispute['status'],
    adminId?: string,
    adminNotes?: string
  ): Promise<void> {
    const resolvedStatuses = ['resolved_refund', 'resolved_release', 'closed'];
    const resolvedAt = resolvedStatuses.includes(status) ? 'NOW()' : 'NULL';

    await client.query(
      `UPDATE disputes
       SET status = $1, admin_id = $2, admin_notes = $3, resolved_at = ${resolvedAt}, updated_at = NOW()
       WHERE id = $4`,
      [status, adminId || null, adminNotes || null, id]
    );
  },

  async findAll(
    options: {
      status?: Dispute['status'];
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ disputes: Dispute[]; total: number }> {
    const { status, limit = 20, offset = 0 } = options;
    const conditions: string[] = [];
    const values: (string | number | boolean | Date | null)[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`d.status = $${paramIndex++}`);
      values.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM disputes d ${whereClause}`,
      values
    );

    const dataValues = [...values, limit, offset];
    const { rows } = await db.query<Dispute>(
      `SELECT d.* FROM disputes d ${whereClause}
       ORDER BY d.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      dataValues
    );

    return {
      disputes: rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  },
};
