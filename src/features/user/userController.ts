import { Response, NextFunction } from 'express';
import { UserModel } from '../../models';
import { userService } from './userService';
import { AuthenticatedRequest } from '../../types';
import { ok } from '../../utils/respond';

export const getProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const { wallet } = await userService.getProfile(req.user!.id);
    return ok(res, { user: req.user, wallet });
  } catch (err) { next(err); }
};

export const updateProfile = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const user = await userService.updateProfile(req.user!.id, req.body);
    return ok(res, { user }, 'Profile updated');
  } catch (err) { next(err); }
};

export const changePassword = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    await userService.changePassword(req.user!.id, req.body.current_password, req.body.new_password);
    return ok(res, undefined, 'Password updated successfully');
  } catch (err) { next(err); }
};

export const updateFcmToken = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const { token } = req.body;
    await UserModel.updateFcmToken(req.user!.id, token);
    return ok(res, undefined, 'FCM token updated successfully');
  } catch (err) { next(err); }
};

export const searchUsers = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const users = await userService.searchUsers(req.query.q as string, req.user!.id, req.user!.phone_number);
    return ok(res, users);
  } catch (err) { next(err); }
};
