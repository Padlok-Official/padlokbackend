import { Response, NextFunction } from 'express';
import { UserModel, AuditLogModel } from '../models';
import { AuthenticatedRequest } from '../types';

const MAX_PIN_ATTEMPTS = 7;
const PIN_LOCK_DURATION_MS = 2 * 60 * 1000; // 2 minutes

export const requirePin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { pin } = req.body;

    if (!pin) {
      return res.status(400).json({
        success: false,
        message: 'Transaction PIN is required',
      });
    }

    const userId = req.user!.id;
    const pinData = await UserModel.getPinData(userId);

    if (!pinData.pin_hash) {
      return res.status(400).json({
        success: false,
        message: 'PIN not set. Please set your PIN first.',
      });
    }

    // Check lockout
    if (pinData.pin_locked_until && new Date(pinData.pin_locked_until) > new Date()) {
      const remainingMs = new Date(pinData.pin_locked_until).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return res.status(429).json({
        success: false,
        message: `PIN locked due to too many failed attempts. Try again in ${remainingMin} minute(s).`,
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
          action: 'pin_locked',
          entity_type: 'user',
          entity_id: userId,
          details: { reason: 'max_attempts_exceeded', locked_until: lockUntil.toISOString() },
          ip_address: req.ip,
          user_agent: req.headers['user-agent'],
        });

        return res.status(429).json({
          success: false,
          message: 'PIN locked for 2 minutes due to too many failed attempts.',
        });
      }

      return res.status(403).json({
        success: false,
        message: 'Invalid PIN',
        remaining_attempts: MAX_PIN_ATTEMPTS - attempts,
      });
    }

    await UserModel.resetPinAttempts(userId);
    next();
  } catch (err) {
    next(err);
  }
};
