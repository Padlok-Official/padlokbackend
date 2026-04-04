import db from '../config/database';
import { InAppNotification } from '../types';

export const NotificationModel = {
  async create(data: {
    user_id: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<InAppNotification> {
    const { rows } = await db.query<InAppNotification>(
      `INSERT INTO notifications (user_id, type, title, body, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.user_id, data.type, data.title, data.body, JSON.stringify(data.data || {})],
    );
    return rows[0];
  },

  async findByUserId(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<InAppNotification[]> {
    const { rows } = await db.query<InAppNotification>(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return rows;
  },

  async countByUserId(userId: string): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1`,
      [userId],
    );
    return parseInt(rows[0].count, 10);
  },

  async countUnread(userId: string): Promise<number> {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
      [userId],
    );
    return parseInt(rows[0].count, 10);
  },

  async markAsRead(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await db.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 AND is_read = FALSE`,
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  },

  async markAllAsRead(userId: string): Promise<number> {
    const { rowCount } = await db.query(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
      [userId],
    );
    return rowCount ?? 0;
  },
};
