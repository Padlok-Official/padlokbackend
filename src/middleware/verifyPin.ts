import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { WalletModel } from '../models';
import { AuditLogModel } from '../models';
import { AuthenticatedRequest } from '../types';

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_DURATION_MS = 30 * 60 * 1000; // 30 minutes

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

    const wallet = await WalletModel.findByUserIdWithPin(req.user!.id);

    if (!wallet?.pin_hash) {
      return res.status(400).json({
        success: false,
        message: 'Transaction PIN not set. Please set your PIN first.',
      });
    }

    // Check lockout
    if (wallet.pin_locked_until && new Date(wallet.pin_locked_until) > new Date()) {
      const remainingMs = new Date(wallet.pin_locked_until).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return res.status(429).json({
        success: false,
        message: `PIN locked due to too many failed attempts. Try again in ${remainingMin} minute(s).`,
      });
    }

    const valid = await bcrypt.compare(pin, wallet.pin_hash);

    if (!valid) {
      const attempts = await WalletModel.incrementPinAttempts(wallet.id);

      if (attempts >= MAX_PIN_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + PIN_LOCK_DURATION_MS);
        await WalletModel.lockPin(wallet.id, lockUntil);

        await AuditLogModel.log({
          user_id: req.user!.id,
          action: 'pin_locked',
          entity_type: 'wallet',
          entity_id: wallet.id,
          details: { reason: 'max_attempts_exceeded', locked_until: lockUntil.toISOString() },
          ip_address: req.ip,
          user_agent: req.headers['user-agent'],
        });

        return res.status(429).json({
          success: false,
          message: 'PIN locked for 30 minutes due to too many failed attempts.',
        });
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid PIN',
        remaining_attempts: MAX_PIN_ATTEMPTS - attempts,
      });
    }

    await WalletModel.resetPinAttempts(wallet.id);
    next();
  } catch (err) {
    next(err);
  }
};
