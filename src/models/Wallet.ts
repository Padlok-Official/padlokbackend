import db from '../config/database';
import { Wallet } from '../types';

export const WalletModel = {
  async findByUserId(userId: string): Promise<Wallet | null> {
    const { rows } = await db.query<Wallet>(
      `SELECT id, user_id, balance, currency, status, created_at, updated_at
       FROM wallets WHERE user_id = $1`,
      [userId]
    );
    return rows[0] ?? null;
  },

  async create(userId: string, currency = 'NGN'): Promise<void> {
    await db.query(
      `INSERT INTO wallets (user_id, balance, currency, status) VALUES ($1, 0, $2, 'active')`,
      [userId, currency]
    );
  },
};
