import { PoolClient } from 'pg';
import db from '../config/database';
import { Wallet, WalletWithPin } from '../types';

export const WalletModel = {
  async findByUserId(userId: string): Promise<Wallet | null> {
    const { rows } = await db.query<Wallet>(
      `SELECT id, user_id, balance, escrow_balance, currency, status, created_at, updated_at
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
      `SELECT id, user_id, balance, escrow_balance, currency, status, created_at, updated_at
       FROM wallets WHERE id = $1`,
      [walletId]
    );
    return rows[0] ?? null;
  },

  async findByUserIdWithPin(userId: string): Promise<WalletWithPin | null> {
    const { rows } = await db.query<WalletWithPin>(
      `SELECT id, user_id, balance, escrow_balance, currency, status, pin_hash, pin_set_at,
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
    const { rows: [result] } = await client.query<{ balance_before: string; balance_after: string }>(
      `UPDATE wallets SET balance = balance + $1::DECIMAL, updated_at = NOW()
       WHERE id = $2
       RETURNING (balance - $1::DECIMAL)::TEXT as balance_before, balance::TEXT as balance_after`,
      [amount, walletId]
    );

    if (!result) throw new Error('Wallet not found');
    return result;
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
    const { rows: [result] } = await client.query<{ balance_before: string; balance_after: string }>(
      `UPDATE wallets SET
              balance = balance - $1::DECIMAL,
              daily_spent = daily_spent + $1::DECIMAL,
              monthly_spent = monthly_spent + $1::DECIMAL,
              updated_at = NOW()
       WHERE id = $2 AND balance >= $1::DECIMAL
       RETURNING (balance + $1::DECIMAL)::TEXT as balance_before, balance::TEXT as balance_after`,
      [amount, walletId]
    );

    if (!result) {
      // Distinguish between wallet not found vs insufficient balance
      const { rows } = await client.query(`SELECT id FROM wallets WHERE id = $1`, [walletId]);
      if (!rows[0]) throw new Error('Wallet not found');
      throw new Error('Insufficient wallet balance');
    }

    return result;
  },

  /**
   * Credit escrow balance.
   */
  async creditEscrow(
    client: PoolClient,
    walletId: string,
    amount: string
  ): Promise<void> {
    const { rowCount } = await client.query(
      `UPDATE wallets SET escrow_balance = escrow_balance + $1::DECIMAL, updated_at = NOW()
       WHERE id = $2`,
      [amount, walletId]
    );
    if (!rowCount) throw new Error('Wallet not found');
  },

  /**
   * Debit escrow balance. Prevents going negative.
   */
  async debitEscrow(
    client: PoolClient,
    walletId: string,
    amount: string
  ): Promise<void> {
    const { rowCount } = await client.query(
      `UPDATE wallets SET escrow_balance = escrow_balance - $1::DECIMAL, updated_at = NOW()
       WHERE id = $2 AND escrow_balance >= $1::DECIMAL`,
      [amount, walletId]
    );
    if (!rowCount) throw new Error('Insufficient escrow balance or wallet not found');
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
    const { rows } = await db.query<{
      daily_ok: boolean;
      monthly_ok: boolean;
    }>(
      `SELECT
        (CASE WHEN daily_spent_reset_at < CURRENT_DATE THEN 0 ELSE daily_spent END) + $2::DECIMAL <= daily_limit AS daily_ok,
        (CASE WHEN monthly_spent_reset_at < DATE_TRUNC('month', CURRENT_DATE) THEN 0 ELSE monthly_spent END) + $2::DECIMAL <= monthly_limit AS monthly_ok
       FROM wallets WHERE id = $1`,
      [walletId, amount]
    );

    if (!rows[0]) return { allowed: false, reason: 'Wallet not found' };

    if (!rows[0].daily_ok) return { allowed: false, reason: 'Daily spending limit exceeded' };
    if (!rows[0].monthly_ok) return { allowed: false, reason: 'Monthly spending limit exceeded' };

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
