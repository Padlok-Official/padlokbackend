import db from '../config/database';
import { AuditLogEntry } from '../types';

export const AuditLogModel = {
  async log(data: {
    user_id?: string;
    action: string;
    entity_type: string;
    entity_id?: string;
    details?: Record<string, unknown>;
    ip_address?: string;
    user_agent?: string;
  }): Promise<void> {
    await db.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        data.user_id || null,
        data.action,
        data.entity_type,
        data.entity_id || null,
        data.details ? JSON.stringify(data.details) : null,
        data.ip_address || null,
        data.user_agent || null,
      ]
    );
  },

  async findByUserId(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<AuditLogEntry[]> {
    const { rows } = await db.query<AuditLogEntry>(
      `SELECT id, user_id, action, entity_type, entity_id, details, ip_address, user_agent, created_at
       FROM audit_log WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return rows;
  },
};
