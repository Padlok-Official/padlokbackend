import { NextFunction, Response } from 'express';
import { UserModel, WalletModel } from '../models';
import cloudinaryService from '../services/cloudinaryService';
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

    const { name, phone_number, username, bio, location, profile_photo } = req.body;
    const updates: {
      name?: string;
      phone_number?: string;
      username?: string;
      bio?: string;
      location?: string;
      profile_photo?: string;
    } = {};

    if (typeof name === 'string' && name.trim()) {
      updates.name = name.trim();
    }
    if (typeof username === 'string' && username.trim()) {
      const taken = await UserModel.isUsernameTaken(username.trim(), req.user.id);
      if (taken) {
        return res.status(409).json({ success: false, message: 'Username already taken' });
      }
      updates.username = username.trim().toLowerCase();
    }
    if (typeof bio === 'string') {
      updates.bio = bio.trim();
    }
    if (typeof location === 'string') {
      updates.location = location.trim();
    }
    if (typeof profile_photo === 'string' && profile_photo.trim()) {
      // If it's a base64 image string or a temporary path, upload to Cloudinary
      if (profile_photo.startsWith('data:image') || profile_photo.startsWith('file://') || profile_photo.startsWith('/')) {
        try {
          console.log(`Uploading profile photo to Cloudinary for user ${req.user.id}...`);
          const uploadResult = await cloudinaryService.uploadImage(profile_photo, 'profile_photos');
          updates.profile_photo = uploadResult.url;
          console.log(`Profile photo uploaded: ${uploadResult.url}`);
        } catch (error) {
          console.error('Profile photo upload failed:', error);
          return res.status(500).json({
            success: false,
            message: 'Failed to upload profile photo to Cloudinary',
          });
        }
      } else {
        // If it's already a URL (e.g. https://res.cloudinary.com/...), just update it
        updates.profile_photo = profile_photo.trim();
      }
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

    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const users = await UserModel.search(q, req.user.id);

    res.json({
      success: true,
      data: users,
    });
  } catch (err) {
    next(err);
  }
};
