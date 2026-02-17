import bcrypt from 'bcryptjs';
import db from '../config/database';
import { User } from '../types';

const SALT_ROUNDS = 12;

export const UserModel = {
  async findByEmail(email: string): Promise<(User & { password_hash: string; last_login_at: Date | null }) | null> {
    const { rows } = await db.query<User & { password_hash: string; last_login_at: Date | null }>(
      `SELECT id, name, email, phone_number, password_hash, email_verified, phone_verified, is_active, created_at, last_login_at
       FROM users WHERE email = $1 AND is_active = TRUE`,
      [email.toLowerCase().trim()]
    );
    return rows[0] ?? null;
  },

  async findByEmailOrPhone(email: string, phoneNumber: string): Promise<{ id: string } | null> {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 OR phone_number = $2',
      [email.toLowerCase().trim(), phoneNumber.trim()]
    );
    return rows[0] ?? null;
  },

  async findById(id: string): Promise<User | null> {
    const { rows } = await db.query<User>(
      `SELECT id, name, email, phone_number, email_verified, phone_verified, is_active, created_at
       FROM users WHERE id = $1 AND is_active = TRUE`,
      [id]
    );
    return rows[0] ?? null;
  },

  async findByIdWithPassword(id: string): Promise<(User & { password_hash: string }) | null> {
    const { rows } = await db.query<User & { password_hash: string }>(
      `SELECT id, name, email, phone_number, password_hash, email_verified, phone_verified, is_active, created_at
       FROM users WHERE id = $1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async create(data: {
    name: string;
    email: string;
    password_hash: string;
    phone_number: string;
  }): Promise<User> {
    const { rows } = await db.query<User>(
      `INSERT INTO users (name, email, password_hash, phone_number)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone_number, email_verified, phone_verified, is_active, created_at`,
      [
        data.name.trim(),
        data.email.toLowerCase().trim(),
        data.password_hash,
        data.phone_number.trim(),
      ]
    );
    return rows[0];
  },

  async update(
    id: string,
    updates: { name?: string; phone_number?: string }
  ): Promise<User | null> {
    const setClauses: string[] = [];
    const values: (string | number)[] = [];
    let idx = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${idx++}`);
      values.push(updates.name.trim());
    }
    if (updates.phone_number !== undefined) {
      setClauses.push(`phone_number = $${idx++}`);
      values.push(updates.phone_number.trim());
    }

    if (setClauses.length === 0) return null;

    values.push(id);
    const { rows } = await db.query<User>(
      `UPDATE users SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${idx}
       RETURNING id, name, email, phone_number, email_verified, phone_verified, is_active, created_at`,
      values
    );
    return rows[0] ?? null;
  },

  async updatePassword(id: string, password_hash: string): Promise<void> {
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [password_hash, id]
    );
  },

  async updateLastLogin(id: string): Promise<void> {
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [id]);
  },

  async isPhoneNumberTaken(phoneNumber: string, excludeUserId?: string): Promise<boolean> {
    const { rows } = excludeUserId
      ? await db.query<{ id: string }>(
        'SELECT id FROM users WHERE phone_number = $1 AND id != $2',
        [phoneNumber.trim(), excludeUserId]
      )
      : await db.query<{ id: string }>(
        'SELECT id FROM users WHERE phone_number = $1',
        [phoneNumber.trim()]
      );
    return rows.length > 0;
  },

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  },

  comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },
};
