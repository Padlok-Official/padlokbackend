import db from '../config/database';
import { IOTP, CreateOTPData } from '../types/otp';

interface OTPRow {
    id: string;
    email: string;
    otp: string;
    expires_at: Date;
    verified: boolean;
    attempts: number;
    created_at: Date;
    updated_at: Date;
}

const otpModel = {
    /**
     * Find a valid (unverified, not expired) OTP by email
     */
    findValidOTP: async (email: string): Promise<IOTP | undefined> => {
        const result = await db.query<OTPRow>(
            `SELECT * FROM otps 
       WHERE email = $1 
       AND verified = FALSE 
       AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            return undefined;
        }

        const row = result.rows[0];
        return {
            id: row.id,
            email: row.email,
            otp: row.otp,
            expiresAt: row.expires_at,
            verified: row.verified,
            attempts: row.attempts,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    },

    /**
     * Find a verified OTP by email
     */
    findVerifiedOTP: async (email: string): Promise<IOTP | undefined> => {
        const result = await db.query<OTPRow>(
            `SELECT * FROM otps 
       WHERE email = $1 
       AND verified = TRUE 
       AND expires_at > NOW()
       ORDER BY updated_at DESC
       LIMIT 1`,
            [email.toLowerCase().trim()]
        );

        if (result.rows.length === 0) {
            return undefined;
        }

        const row = result.rows[0];
        return {
            id: row.id,
            email: row.email,
            otp: row.otp,
            expiresAt: row.expires_at,
            verified: row.verified,
            attempts: row.attempts,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    },

    /**
     * Create a new OTP
     */
    create: async (data: CreateOTPData): Promise<IOTP> => {
        const result = await db.query<OTPRow>(
            `INSERT INTO otps (email, otp, expires_at, verified, attempts)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
            [
                data.email.toLowerCase().trim(),
                data.otp,
                data.expiresAt,
                data.verified || false,
                data.attempts || 0,
            ]
        );

        const row = result.rows[0];
        return {
            id: row.id,
            email: row.email,
            otp: row.otp,
            expiresAt: row.expires_at,
            verified: row.verified,
            attempts: row.attempts,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    },

    /**
     * Update an OTP
     */
    update: async (id: string, data: Partial<CreateOTPData>): Promise<IOTP | undefined> => {
        const updates: string[] = [];
        const values: any[] = [];
        let paramCount = 1;

        if (data.verified !== undefined) {
            updates.push(`verified = $${paramCount++}`);
            values.push(data.verified);
        }
        if (data.attempts !== undefined) {
            updates.push(`attempts = $${paramCount++}`);
            values.push(data.attempts);
        }

        if (updates.length === 0) {
            return await otpModel.findById(id);
        }

        values.push(id);
        const result = await db.query<OTPRow>(
            `UPDATE otps 
       SET ${updates.join(', ')}, updated_at = NOW() 
       WHERE id = $${paramCount}
       RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return undefined;
        }

        const row = result.rows[0];
        return {
            id: row.id,
            email: row.email,
            otp: row.otp,
            expiresAt: row.expires_at,
            verified: row.verified,
            attempts: row.attempts,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    },

    /**
     * Find OTP by ID
     */
    findById: async (id: string): Promise<IOTP | undefined> => {
        const result = await db.query<OTPRow>(
            'SELECT * FROM otps WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return undefined;
        }

        const row = result.rows[0];
        return {
            id: row.id,
            email: row.email,
            otp: row.otp,
            expiresAt: row.expires_at,
            verified: row.verified,
            attempts: row.attempts,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    },

    /**
     * Delete unverified OTPs for an email
     */
    deleteUnverified: async (email: string): Promise<void> => {
        await db.query(
            'DELETE FROM otps WHERE email = $1 AND verified = FALSE',
            [email.toLowerCase().trim()]
        );
    },

    /**
     * Delete an OTP by ID
     */
    delete: async (id: string): Promise<boolean> => {
        const result = await db.query(
            'DELETE FROM otps WHERE id = $1 RETURNING id',
            [id]
        );
        return result.rows.length > 0;
    },
};

export default otpModel;
