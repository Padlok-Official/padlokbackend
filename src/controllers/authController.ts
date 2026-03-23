import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { UserModel, WalletModel, RefreshTokenModel, AuditLogModel } from '../models';
import { User, AuthenticatedRequest } from '../types';
import { getCurrencyFromPhoneNumber } from '../utils/currencyUtils';

const MAX_PIN_ATTEMPTS = 3;
const PIN_LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

const JWT_SECRET = process.env.JWT_SECRET as string;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';

const signOptions = { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions;

function getRequestMeta(req: Request): { userAgent: string | null; ipAddress: string | null } {
  const userAgent = (req.headers['user-agent'] as string) ?? null;
  const ipAddress =
    (req as Request & { ip?: string }).ip ?? req.socket.remoteAddress ?? null;
  return { userAgent, ipAddress };
}

function toAuthUser(user: User & { pin_set_at?: Date | null }) {
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

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { name, email, password, phone_number } = req.body;

    console.log("user registeration data ----> ", req.body)

    const existing = await UserModel.findByEmailOrPhone(
      email,
      phone_number
    );
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Email or phone number already registered',
      });
    }

    const password_hash = await UserModel.hashPassword(password);
    const user = await UserModel.create({
      name,
      email,
      password_hash,
      phone_number,
    });

    const currency = getCurrencyFromPhoneNumber(phone_number);
    await WalletModel.create(user.id, currency);

    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      signOptions
    );

    const refreshToken = uuidv4();
    const refreshHash = await UserModel.hashPassword(refreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { userAgent, ipAddress } = getRequestMeta(req);
    await RefreshTokenModel.create({
      userId: user.id,
      tokenHash: refreshHash,
      expiresAt,
      userAgent,
      ipAddress,
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user: toAuthUser(user),
        accessToken,
        refreshToken,
        expiresIn: JWT_EXPIRES_IN,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { email, password } = req.body;

    const user = await UserModel.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const valid = await UserModel.comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    await UserModel.updateLastLogin(user.id);

    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      signOptions
    );

    const refreshToken = uuidv4();
    const refreshHash = await UserModel.hashPassword(refreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { userAgent, ipAddress } = getRequestMeta(req);
    await RefreshTokenModel.create({
      userId: user.id,
      tokenHash: refreshHash,
      expiresAt,
      userAgent,
      ipAddress,
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: toAuthUser(user),
        accessToken,
        refreshToken,
        expiresIn: JWT_EXPIRES_IN,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { refreshToken: token } = req.body;
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required',
      });
    }

    let userId: string | null = null;
    if (accessToken) {
      const decoded = jwt.decode(accessToken) as { userId?: string } | null;
      if (decoded?.userId) userId = decoded.userId;
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Valid or expired access token required to refresh',
      });
    }

    const tokenRows = await RefreshTokenModel.findActiveByUserId(userId);
    let matchedRow: (typeof tokenRows)[0] | null = null;
    for (const row of tokenRows) {
      const isMatch = await bcrypt.compare(token, row.token_hash);
      if (isMatch) {
        matchedRow = row;
        break;
      }
    }

    if (!matchedRow) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token',
      });
    }

    const user = await UserModel.findById(matchedRow.user_id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found or inactive',
      });
    }

    await RefreshTokenModel.revokeById(matchedRow.id);

    const newAccessToken = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      signOptions
    );

    const newRefreshToken = uuidv4();
    const refreshHash = await UserModel.hashPassword(newRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { userAgent, ipAddress } = getRequestMeta(req);
    await RefreshTokenModel.create({
      userId: user.id,
      tokenHash: refreshHash,
      expiresAt,
      userAgent,
      ipAddress,
    });

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: JWT_EXPIRES_IN,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const setAppPin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { pin } = req.body;
    const userId = req.user!.id;

    const { pin_hash } = await UserModel.getPinData(userId);
    if (pin_hash) {
      return res.status(409).json({
        success: false,
        message: 'App PIN is already set. Use change-pin to update it.',
      });
    }

    const hash = await UserModel.hashPassword(pin);
    await UserModel.setPin(userId, hash);

    await AuditLogModel.log({
      user_id: userId,
      action: 'app_pin_set',
      entity_type: 'user',
      entity_id: userId,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
    });

    res.status(201).json({
      success: true,
      message: 'App PIN set successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const verifyAppPin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { pin } = req.body;
    const userId = req.user!.id;

    const pinData = await UserModel.getPinData(userId);
    if (!pinData.pin_hash) {
      return res.status(400).json({
        success: false,
        message: 'No app PIN set for this account.',
      });
    }

    // Check lockout
    if (pinData.pin_locked_until && new Date(pinData.pin_locked_until) > new Date()) {
      const remainingMs = new Date(pinData.pin_locked_until).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return res.status(429).json({
        success: false,
        message: `PIN locked due to too many failed attempts. Try again in ${remainingMin} minute(s).`,
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

        await AuditLogModel.log({
          user_id: userId,
          action: 'app_pin_locked',
          entity_type: 'user',
          entity_id: userId,
          details: { reason: 'max_attempts_exceeded', locked_until: lockUntil.toISOString() },
          ip_address: req.ip,
          user_agent: req.headers['user-agent'],
        });

        return res.status(429).json({
          success: false,
          message: 'PIN locked for 30 minutes due to too many failed attempts.',
          locked_until: lockUntil,
          remaining_attempts: 0,
        });
      }

      await AuditLogModel.log({
        user_id: userId,
        action: 'app_pin_failed',
        entity_type: 'user',
        entity_id: userId,
        details: { attempts },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      return res.status(401).json({
        success: false,
        message: 'Incorrect PIN',
        remaining_attempts: MAX_PIN_ATTEMPTS - attempts,
      });
    }

    // Success — reset attempts
    await UserModel.resetPinAttempts(userId);

    res.json({ success: true, message: 'PIN verified' });
  } catch (err) {
    next(err);
  }
};

export const changeAppPin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { old_pin, new_pin } = req.body;
    const userId = req.user!.id;

    const pinData = await UserModel.getPinData(userId);
    if (!pinData.pin_hash) {
      return res.status(400).json({
        success: false,
        message: 'No app PIN set for this account.',
      });
    }

    // Check lockout (same protection as verify)
    if (pinData.pin_locked_until && new Date(pinData.pin_locked_until) > new Date()) {
      const remainingMs = new Date(pinData.pin_locked_until).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return res.status(429).json({
        success: false,
        message: `PIN locked. Try again in ${remainingMin} minute(s).`,
      });
    }

    const valid = await UserModel.comparePassword(old_pin, pinData.pin_hash);
    if (!valid) {
      const attempts = await UserModel.incrementPinAttempts(userId);

      if (attempts >= MAX_PIN_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + PIN_LOCK_DURATION_MS);
        await UserModel.lockPin(userId, lockUntil);
      }

      return res.status(401).json({
        success: false,
        message: 'Current PIN is incorrect',
        remaining_attempts: Math.max(0, MAX_PIN_ATTEMPTS - attempts),
      });
    }

    await UserModel.resetPinAttempts(userId);
    const hash = await UserModel.hashPassword(new_pin);
    await UserModel.setPin(userId, hash);

    await AuditLogModel.log({
      user_id: userId,
      action: 'app_pin_changed',
      entity_type: 'user',
      entity_id: userId,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
    });

    res.json({ success: true, message: 'App PIN changed successfully' });
  } catch (err) {
    next(err);
  }
};

export const logout = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { refreshToken: token } = req.body;

    if (token) {
      const tokenRows = await RefreshTokenModel.findActiveByUserId(req.user!.id);
      for (const row of tokenRows) {
        const isMatch = await bcrypt.compare(token, row.token_hash);
        if (isMatch) {
          await RefreshTokenModel.revokeById(row.id);
          break;
        }
      }
    }

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};
