interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
}

export interface IRefreshTokenRepository {
  create(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ipAddress: string | null;
  }): Promise<{ id: string }>;
  findActiveById(id: string, userId: string): Promise<RefreshTokenRow | null>;
  findActiveByUserId(userId: string): Promise<RefreshTokenRow[]>;
  revokeById(id: string): Promise<void>;
  revokeAllByUserId(userId: string): Promise<void>;
}
