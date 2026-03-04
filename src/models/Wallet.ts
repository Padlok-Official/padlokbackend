import { PoolClient } from 'pg';
import db from '../config/database';
import { Wallet, WalletWithPin } from '../types';

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

  async findById(walletId: string): Promise<Wallet | null> {
    const { rows } = await db.query<Wallet>(
      `SELECT id, user_id, balance, currency, status, created_at, updated_at
       FROM wallets WHERE id = $1`,
      [walletId]
    );
    return rows[0] ?? null;
  },

  async findByUserIdWithPin(userId: string): Promise<WalletWithPin | null> {
    const { rows } = await db.query<WalletWithPin>(
      `SELECT id, user_id, balance, currency, status, pin_hash, pin_set_at,
              pin_attempts, pin_locked_until, daily_limit, monthly_limit,
              daily_spent, monthly_spent, daily_spent_reset_at, monthly_spent_reset_at,
              created_at, updated_at
       FROM wallets WHERE user_id = $1`,
      [userId]
    );
    return rows[0] ?? null;
  },

  async setPin(walletId: string, pinHash: string): Promise<void> {
    await db.query(
      `UPDATE wallets SET pin_hash = $1, pin_set_at = NOW(), pin_attempts = 0, updated_at = NOW()
       WHERE id = $2`,
      [pinHash, walletId]
    );
  },

  async incrementPinAttempts(walletId: string): Promise<number> {
    const { rows } = await db.query<{ pin_attempts: number }>(
      `UPDATE wallets SET pin_attempts = pin_attempts + 1, updated_at = NOW()
       WHERE id = $1 RETURNING pin_attempts`,
      [walletId]
    );
    return rows[0].pin_attempts;
  },

  async lockPin(walletId: string, lockedUntil: Date): Promise<void> {
    await db.query(
      `UPDATE wallets SET pin_locked_until = $1, updated_at = NOW() WHERE id = $2`,
      [lockedUntil, walletId]
    );
  },

  async resetPinAttempts(walletId: string): Promise<void> {
    await db.query(
      `UPDATE wallets SET pin_attempts = 0, pin_locked_until = NULL, updated_at = NOW()
       WHERE id = $1`,
      [walletId]
    );
  },

  /**
   * Credit wallet balance with row-level locking.
   * MUST be called within a database transaction (BEGIN/COMMIT).
   */
  async creditBalance(
    client: PoolClient,
    walletId: string,
    amount: string
  ): Promise<{ balance_before: string; balance_after: string }> {
    const { rows: [wallet] } = await client.query<{ balance: string }>(
      `SELECT balance FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId]
    );

    if (!wallet) throw new Error('Wallet not found');

    const balanceBefore = wallet.balance;

    const { rows: [updated] } = await client.query<{ balance: string }>(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
       WHERE id = $2 RETURNING balance`,
      [amount, walletId]
    );

    return { balance_before: balanceBefore, balance_after: updated.balance };
  },

  /**
   * Debit wallet balance with row-level locking and balance check.
   * MUST be called within a database transaction (BEGIN/COMMIT).
   * Throws if insufficient balance.
   */
  async debitBalance(
    client: PoolClient,
    walletId: string,
    amount: string
  ): Promise<{ balance_before: string; balance_after: string }> {
    const { rows: [wallet] } = await client.query<{ balance: string }>(
      `SELECT balance FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId]
    );

    if (!wallet) throw new Error('Wallet not found');

    const balanceBefore = parseFloat(wallet.balance);
    const debitAmount = parseFloat(amount);

    if (balanceBefore < debitAmount) {
      throw new Error('Insufficient wallet balance');
    }

    const { rows: [updated] } = await client.query<{ balance: string }>(
      `UPDATE wallets SET balance = balance - $1,
              daily_spent = daily_spent + $1,
              monthly_spent = monthly_spent + $1,
              updated_at = NOW()
       WHERE id = $2 RETURNING balance`,
      [amount, walletId]
    );

    return { balance_before: wallet.balance, balance_after: updated.balance };
  },

  async resetSpendingIfNeeded(client: PoolClient, walletId: string): Promise<void> {
    await client.query(
      `UPDATE wallets SET
        daily_spent = CASE WHEN daily_spent_reset_at < CURRENT_DATE THEN 0 ELSE daily_spent END,
        daily_spent_reset_at = CASE WHEN daily_spent_reset_at < CURRENT_DATE THEN CURRENT_DATE ELSE daily_spent_reset_at END,
        monthly_spent = CASE WHEN monthly_spent_reset_at < DATE_TRUNC('month', CURRENT_DATE) THEN 0 ELSE monthly_spent END,
        monthly_spent_reset_at = CASE WHEN monthly_spent_reset_at < DATE_TRUNC('month', CURRENT_DATE) THEN DATE_TRUNC('month', CURRENT_DATE) ELSE monthly_spent_reset_at END
       WHERE id = $1`,
      [walletId]
    );
  },

  async checkSpendingLimits(
    walletId: string,
    amount: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const { rows } = await db.query<WalletWithPin>(
      `SELECT daily_limit, monthly_limit, daily_spent, monthly_spent,
              daily_spent_reset_at, monthly_spent_reset_at
       FROM wallets WHERE id = $1`,
      [walletId]
    );

    if (!rows[0]) return { allowed: false, reason: 'Wallet not found' };

    const wallet = rows[0];
    const amountNum = parseFloat(amount);

    const today = new Date().toISOString().split('T')[0];
    const dailySpent = wallet.daily_spent_reset_at < today ? 0 : parseFloat(wallet.daily_spent);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const monthlySpent = wallet.monthly_spent_reset_at < monthStart ? 0 : parseFloat(wallet.monthly_spent);

    if (dailySpent + amountNum > parseFloat(wallet.daily_limit)) {
      return { allowed: false, reason: 'Daily spending limit exceeded' };
    }

    if (monthlySpent + amountNum > parseFloat(wallet.monthly_limit)) {
      return { allowed: false, reason: 'Monthly spending limit exceeded' };
    }

    return { allowed: true };
  },

  async updateLimits(
    walletId: string,
    daily?: string,
    monthly?: string
  ): Promise<void> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: (string | number | boolean | Date | null)[] = [];
    let paramIndex = 1;

    if (daily) {
      setClauses.push(`daily_limit = $${paramIndex++}`);
      values.push(daily);
    }
    if (monthly) {
      setClauses.push(`monthly_limit = $${paramIndex++}`);
      values.push(monthly);
    }

    values.push(walletId);
    await db.query(
      `UPDATE wallets SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
  },

  async updateStatus(
    walletId: string,
    status: 'active' | 'frozen' | 'suspended'
  ): Promise<void> {
    await db.query(
      `UPDATE wallets SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, walletId]
    );
  },
};
