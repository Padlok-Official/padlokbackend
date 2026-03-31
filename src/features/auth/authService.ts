import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UserModel, WalletModel, RefreshTokenModel, AuditLogModel } from '../../models';
import { getCurrencyFromPhoneNumber } from '../../utils/currencyUtils';
import { AppError } from '../../utils/AppError';

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';
const REFRESH_DAYS = parseInt(process.env.JWT_REFRESH_EXPIRES_IN ?? '30') || 30;
const signOptions = { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions;

const MAX_PIN_ATTEMPTS = 3;
const PIN_LOCK_DURATION_MS = 30 * 60 * 1000;

async function issueTokens(userId: string, email: string, meta: { ip_address?: string | undefined; user_agent?: string | undefined }) {
  const accessToken = jwt.sign({ userId, email }, JWT_SECRET, signOptions);
  const refreshToken = uuidv4();
  const refreshHash = await UserModel.hashPassword(refreshToken);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_DAYS);

  const { id: refreshTokenId } = await RefreshTokenModel.create({
    userId,
    tokenHash: refreshHash,
    expiresAt,
    userAgent: meta.user_agent ?? null,
    ipAddress: meta.ip_address ?? null,
  });

  return { accessToken, refreshToken, refreshTokenId, expiresIn: JWT_EXPIRES_IN };
}

function toAuthUser(user: { id: string; name: string; email: string; phone_number: string; email_verified: boolean; phone_verified: boolean; pin_set_at?: Date | null }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone_number: user.phone_number,
    email_verified: user.email_verified,
    phone_verified: user.phone_verified,
    has_pin: !!user.pin_set_at,
  };
}

export const authService = {
  async register(params: { name: string; email: string; password: string; phoneNumber: string; meta: { ip_address?: string | undefined; user_agent?: string | undefined } }) {
    const existing = await UserModel.findByEmailOrPhone(params.email, params.phoneNumber);
    if (existing) throw new AppError('Email or phone number already registered', 409);

    const password_hash = await UserModel.hashPassword(params.password);
    const user = await UserModel.create({ name: params.name, email: params.email, password_hash, phone_number: params.phoneNumber });
    await WalletModel.create(user.id, getCurrencyFromPhoneNumber(params.phoneNumber));

    const tokens = await issueTokens(user.id, user.email, params.meta);
    return { user: toAuthUser(user), ...tokens };
  },

  async login(params: { email: string; password: string; meta: { ip_address?: string | undefined; user_agent?: string | undefined } }) {
    const user = await UserModel.findByEmail(params.email);
    if (!user) throw new AppError('Invalid email or password', 401);

    const valid = await UserModel.comparePassword(params.password, user.password_hash);
    if (!valid) throw new AppError('Invalid email or password', 401);

    await UserModel.updateLastLogin(user.id);
    const tokens = await issueTokens(user.id, user.email, params.meta);
    return { user: toAuthUser(user), ...tokens };
  },

  async refreshToken(params: { token: string; refreshTokenId?: string; authHeader?: string; meta: { ip_address?: string | undefined; user_agent?: string | undefined } }) {
    const { token, refreshTokenId, authHeader } = params;

    let userIdHint: string | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      const decoded = jwt.decode(authHeader.slice(7)) as { userId?: string } | null;
      if (decoded?.userId) userIdHint = decoded.userId;
    }

    let matchedRow: { id: string; user_id: string; token_hash: string } | null = null;

    if (refreshTokenId && userIdHint) {
      matchedRow = await RefreshTokenModel.findActiveById(refreshTokenId, userIdHint);
      if (matchedRow && !(await bcrypt.compare(token, matchedRow.token_hash))) matchedRow = null;
    }

    if (!matchedRow) {
      if (!userIdHint) throw new AppError('Access token required to identify session', 401);
      const rows = await RefreshTokenModel.findActiveByUserId(userIdHint);
      for (const row of rows) {
        if (await bcrypt.compare(token, row.token_hash)) { matchedRow = row; break; }
      }
    }

    if (!matchedRow) throw new AppError('Invalid or expired refresh token', 401);

    const user = await UserModel.findById(matchedRow.user_id);
    if (!user) throw new AppError('User not found or inactive', 401);

    await RefreshTokenModel.revokeById(matchedRow.id);
    return issueTokens(user.id, user.email, params.meta);
  },

  async logout(params: { token?: string; refreshTokenId?: string; all?: boolean; authHeader?: string }) {
    const { token, refreshTokenId, all, authHeader } = params;

    if (all) {
      if (!authHeader) throw new AppError('Access token required for all-device logout', 400);
      let userId: string | null = null;
      try {
        const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as { userId: string };
        userId = decoded.userId;
      } catch {
        const decoded = jwt.decode(authHeader.slice(7)) as { userId?: string } | null;
        if (decoded?.userId) userId = decoded.userId;
      }
      if (!userId) throw new AppError('Could not identify user', 401);
      await RefreshTokenModel.revokeAllByUserId(userId);
      return;
    }

    if (!token) return;

    const decoded = authHeader?.startsWith('Bearer ')
      ? (jwt.decode(authHeader.slice(7)) as { userId?: string } | null)
      : null;
    const userId = decoded?.userId ?? null;
    if (!userId) return;

    if (refreshTokenId) {
      const row = await RefreshTokenModel.findActiveById(refreshTokenId, userId);
      if (row && (await bcrypt.compare(token, row.token_hash))) {
        await RefreshTokenModel.revokeById(row.id);
        return;
      }
    }

    const rows = await RefreshTokenModel.findActiveByUserId(userId);
    for (const row of rows) {
      if (await bcrypt.compare(token, row.token_hash)) {
        await RefreshTokenModel.revokeById(row.id);
        break;
      }
    }
  },

  async setAppPin(userId: string, pin: string, meta: { ip_address?: string | undefined; user_agent?: string | undefined }) {
    const { pin_hash } = await UserModel.getPinData(userId);
    if (pin_hash) throw new AppError('App PIN is already set. Use change-pin to update it.', 409);

    await UserModel.setPin(userId, await UserModel.hashPassword(pin));
    await AuditLogModel.log({ user_id: userId, action: 'app_pin_set', entity_type: 'user', entity_id: userId, ...meta });
  },

  async verifyAppPin(userId: string, pin: string, meta: { ip_address?: string | undefined; user_agent?: string | undefined }) {
    const pinData = await UserModel.getPinData(userId);
    if (!pinData.pin_hash) throw new AppError('No app PIN set for this account.', 400);

    if (pinData.pin_locked_until && new Date(pinData.pin_locked_until) > new Date()) {
      const remainingMin = Math.ceil((new Date(pinData.pin_locked_until).getTime() - Date.now()) / 60000);
      throw new AppError(`PIN locked due to too many failed attempts. Try again in ${remainingMin} minute(s).`, 429, {
        locked_until: pinData.pin_locked_until,
        remaining_minutes: remainingMin,
      });
    }

    const valid = await UserModel.comparePassword(pin, pinData.pin_hash);
    if (!valid) {
      const attempts = await UserModel.incrementPinAttempts(userId);
      if (attempts >= MAX_PIN_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + PIN_LOCK_DURATION_MS);
        await UserModel.lockPin(userId, lockUntil);
        await AuditLogModel.log({ user_id: userId, action: 'app_pin_locked', entity_type: 'user', entity_id: userId, details: { reason: 'max_attempts_exceeded', locked_until: lockUntil.toISOString() }, ...meta });
        throw new AppError('PIN locked for 30 minutes due to too many failed attempts.', 429, { locked_until: lockUntil, remaining_attempts: 0 });
      }
      await AuditLogModel.log({ user_id: userId, action: 'app_pin_failed', entity_type: 'user', entity_id: userId, details: { attempts }, ...meta });
      throw new AppError('Incorrect PIN', 401, { remaining_attempts: MAX_PIN_ATTEMPTS - attempts });
    }

    await UserModel.resetPinAttempts(userId);
  },

  async changeAppPin(userId: string, oldPin: string, newPin: string, meta: { ip_address?: string | undefined; user_agent?: string | undefined }) {
    const pinData = await UserModel.getPinData(userId);
    if (!pinData.pin_hash) throw new AppError('No app PIN set for this account.', 400);

    if (pinData.pin_locked_until && new Date(pinData.pin_locked_until) > new Date()) {
      const remainingMin = Math.ceil((new Date(pinData.pin_locked_until).getTime() - Date.now()) / 60000);
      throw new AppError(`PIN locked. Try again in ${remainingMin} minute(s).`, 429);
    }

    const valid = await UserModel.comparePassword(oldPin, pinData.pin_hash);
    if (!valid) {
      const attempts = await UserModel.incrementPinAttempts(userId);
      if (attempts >= MAX_PIN_ATTEMPTS) await UserModel.lockPin(userId, new Date(Date.now() + PIN_LOCK_DURATION_MS));
      throw new AppError('Current PIN is incorrect', 401, { remaining_attempts: Math.max(0, MAX_PIN_ATTEMPTS - attempts) });
    }

    await UserModel.resetPinAttempts(userId);
    await UserModel.setPin(userId, await UserModel.hashPassword(newPin));
    await AuditLogModel.log({ user_id: userId, action: 'app_pin_changed', entity_type: 'user', entity_id: userId, ...meta });
  },
};
