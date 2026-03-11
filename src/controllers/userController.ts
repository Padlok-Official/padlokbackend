import { NextFunction, Response } from 'express';
import { UserModel, WalletModel } from '../models';
import { AuthenticatedRequest } from '../types';

export const getProfile = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const wallet = await WalletModel.findByUserId(req.user.id);

    res.json({
      success: true,
      data: {
        user: req.user,
        wallet: wallet
          ? {
            id: wallet.id,
            balance: wallet.balance,
            currency: wallet.currency,
            status: wallet.status,
          }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const updateProfile = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { name, phone_number } = req.body;
    const updates: { name?: string; phone_number?: string } = {};

    if (typeof name === 'string' && name.trim()) {
      updates.name = name.trim();
    }
    if (typeof phone_number === 'string' && phone_number.trim()) {
      const taken = await UserModel.isPhoneNumberTaken(
        phone_number.trim(),
        req.user.id
      );
      if (taken) {
        return res.status(409).json({
          success: false,
          message: 'Phone number already in use',
        });
      }
      updates.phone_number = phone_number.trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update',
      });
    }

    const user = await UserModel.update(req.user.id, updates);
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Update failed',
      });
    }

    res.json({
      success: true,
      message: 'Profile updated',
      data: { user },
    });
  } catch (err) {
    next(err);
  }
};

export const changePassword = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { current_password, new_password } = req.body;

    const user = await UserModel.findByIdWithPassword(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const valid = await UserModel.comparePassword(
      current_password,
      user.password_hash
    );
    if (!valid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    const password_hash = await UserModel.hashPassword(new_password);
    await UserModel.updatePassword(req.user.id, password_hash);

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
};

export const updateFcmToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { token } = req.body;

    if (token !== null && typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Invalid token format',
      });
    }

    await UserModel.updateFcmToken(req.user.id, token);

    res.json({
      success: true,
      message: 'FCM token updated successfully',
    });
  } catch (err) {
    next(err);
  }
};

export const searchUsers = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { q } = req.query;

    if (typeof q !== 'string' || !q.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required',
      });
    }

    const users = await UserModel.search(q);

    res.json({
      success: true,
      data: users,
    });
  } catch (err) {
    next(err);
  }
};
