import db from '../config/database';
import { PaymentMethod } from '../types';

export const PaymentMethodModel = {
  async create(data: {
    wallet_id: string;
    type: PaymentMethod['type'];
    provider?: string;
    account_name?: string;
    account_identifier?: string;
    encrypted_account_identifier?: string;
    identifier_iv?: string;
    identifier_auth_tag?: string;
    last_four?: string;
    paystack_auth_code?: string;
    paystack_bank_code?: string;
    paystack_recipient_code?: string;
    is_default?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentMethod> {
    const { rows } = await db.query<PaymentMethod>(
      `INSERT INTO payment_methods
        (wallet_id, type, provider, account_name, account_identifier,
         encrypted_account_identifier, identifier_iv, identifier_auth_tag,
         last_four, paystack_auth_code, paystack_bank_code, paystack_recipient_code,
         is_default, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, wallet_id, type, provider, account_name, last_four,
                 is_default, is_verified, created_at, updated_at`,
      [
        data.wallet_id,
        data.type,
        data.provider || null,
        data.account_name || null,
        data.account_identifier || null,
        data.encrypted_account_identifier || null,
        data.identifier_iv || null,
        data.identifier_auth_tag || null,
        data.last_four || null,
        data.paystack_auth_code || null,
        data.paystack_bank_code || null,
        data.paystack_recipient_code || null,
        data.is_default || false,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );
    return rows[0];
  },

  async findByWalletId(walletId: string): Promise<PaymentMethod[]> {
    const { rows } = await db.query<PaymentMethod>(
      `SELECT id, wallet_id, type, provider, account_name, last_four,
              is_default, is_verified, metadata, created_at, updated_at
       FROM payment_methods WHERE wallet_id = $1
       ORDER BY is_default DESC, created_at DESC`,
      [walletId]
    );
    return rows;
  },

  async findById(id: string): Promise<PaymentMethod | null> {
    const { rows } = await db.query<PaymentMethod>(
      `SELECT * FROM payment_methods WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async findDefaultByWalletId(walletId: string): Promise<PaymentMethod | null> {
    const { rows } = await db.query<PaymentMethod>(
      `SELECT * FROM payment_methods WHERE wallet_id = $1 AND is_default = TRUE LIMIT 1`,
      [walletId]
    );
    return rows[0] ?? null;
  },

  async setDefault(walletId: string, paymentMethodId: string): Promise<void> {
    // Unset all defaults for wallet, then set the specified one
    await db.query(
      `UPDATE payment_methods SET is_default = FALSE WHERE wallet_id = $1`,
      [walletId]
    );
    await db.query(
      `UPDATE payment_methods SET is_default = TRUE WHERE id = $1 AND wallet_id = $2`,
      [paymentMethodId, walletId]
    );
  },

  async delete(id: string, walletId: string): Promise<boolean> {
    const result = await db.query(
      `DELETE FROM payment_methods WHERE id = $1 AND wallet_id = $2`,
      [id, walletId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async markVerified(id: string): Promise<void> {
    await db.query(
      `UPDATE payment_methods SET is_verified = TRUE, updated_at = NOW() WHERE id = $1`,
      [id]
    );
  },

  async findByPaystackAuthCode(authCode: string, walletId: string): Promise<PaymentMethod | null> {
    const { rows } = await db.query<PaymentMethod>(
      `SELECT * FROM payment_methods WHERE paystack_auth_code = $1 AND wallet_id = $2`,
      [authCode, walletId]
    );
    return rows[0] ?? null;
  },
};
