import { UserModel, WalletModel } from '../../models';
import cloudinaryService from '../../infrastructure/cloudinary/cloudinaryService';
import { AppError } from '../../utils/AppError';

export const userService = {
  async getProfile(userId: string) {
    const wallet = await WalletModel.findByUserId(userId);
    return {
      wallet: wallet ? { id: wallet.id, balance: wallet.balance, currency: wallet.currency, status: wallet.status } : null,
    };
  },

  async updateProfile(userId: string, body: Record<string, unknown>) {
    const updates: {
      name?: string;
      phone_number?: string;
      username?: string;
      bio?: string;
      location?: string;
      profile_photo?: string;
    } = {};

    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();

    if (typeof body.username === 'string' && body.username.trim()) {
      const taken = await UserModel.isUsernameTaken(body.username.trim(), userId);
      if (taken) throw new AppError('Username already taken', 409);
      updates.username = body.username.trim().toLowerCase();
    }

    if (typeof body.bio === 'string') updates.bio = body.bio.trim();
    if (typeof body.location === 'string') updates.location = body.location.trim();

    if (typeof body.profile_photo === 'string' && body.profile_photo.trim()) {
      const photo = body.profile_photo.trim();
      if (photo.startsWith('data:image') || photo.startsWith('file://') || photo.startsWith('/')) {
        try {
          const result = await cloudinaryService.uploadImage(photo, 'profile_photos');
          updates.profile_photo = result.url;
        } catch {
          throw new AppError('Failed to upload profile photo to Cloudinary', 500);
        }
      } else {
        updates.profile_photo = photo;
      }
    }

    if (typeof body.phone_number === 'string' && body.phone_number.trim()) {
      const taken = await UserModel.isPhoneNumberTaken(body.phone_number.trim(), userId);
      if (taken) throw new AppError('Phone number already in use', 409);
      updates.phone_number = body.phone_number.trim();
    }

    if (Object.keys(updates).length === 0) throw new AppError('No valid fields to update', 400);

    const user = await UserModel.update(userId, updates);
    if (!user) throw new AppError('Update failed', 400);
    return user;
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await UserModel.findByIdWithPassword(userId);
    if (!user) throw new AppError('User not found', 404);

    const valid = await UserModel.comparePassword(currentPassword, user.password_hash);
    if (!valid) throw new AppError('Current password is incorrect', 401);

    await UserModel.updatePassword(userId, await UserModel.hashPassword(newPassword));
  },

  async searchUsers(query: string, excludeUserId: string) {
    if (!query?.trim()) throw new AppError('Search query is required', 400);
    return UserModel.search(query, excludeUserId);
  },
};
