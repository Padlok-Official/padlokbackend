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
  }): Promise<{ id: string }> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        data.userId,
        data.tokenHash,
        data.expiresAt,
        data.userAgent,
        data.ipAddress,
      ]
    );
    return rows[0];
  },

  /** O(1) lookup by primary key — used when client sends refreshTokenId */
  async findActiveById(id: string, userId: string): Promise<RefreshTokenRow | null> {
    const { rows } = await db.query<RefreshTokenRow>(
      `SELECT id, user_id, token_hash FROM refresh_tokens
       WHERE id = $1 AND user_id = $2 AND expires_at > NOW() AND revoked = FALSE`,
      [id, userId]
    );
    return rows[0] ?? null;
  },

  /** Fallback full scan — used when client only has the raw refresh token (older clients) */
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

  /** Revoke all active sessions for a user — used for logout-all / security events */
  async revokeAllByUserId(userId: string): Promise<void> {
    await db.query(
      'UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE',
      [userId]
    );
  },
};
