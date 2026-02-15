import db from '../config/database';

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
}

export const RefreshTokenModel = {
  async create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<void> {
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        data.userId,
        data.tokenHash,
        data.expiresAt,
        data.userAgent,
        data.ipAddress,
      ]
    );
  },

  async findActiveByUserId(userId: string): Promise<RefreshTokenRow[]> {
    const { rows } = await db.query<RefreshTokenRow>(
      `SELECT id, user_id, token_hash FROM refresh_tokens
       WHERE user_id = $1 AND expires_at > NOW() AND revoked = FALSE`,
      [userId]
    );
    return rows;
  },

  async revokeById(id: string): Promise<void> {
    await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [id]);
  },
};
