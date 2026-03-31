import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../types';
import { authService } from './authService';
import { ok, fail, getRequestMeta } from '../../utils/respond';

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const { name, email, password, phone_number } = req.body;
    const data = await authService.register({ name, email, password, phoneNumber: phone_number, meta: getRequestMeta(req) });
    return ok(res, data, 'Registration successful', 201);
  } catch (err) { next(err); }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const data = await authService.login({ email: req.body.email, password: req.body.password, meta: getRequestMeta(req) });
    return ok(res, data, 'Login successful');
  } catch (err) { next(err); }
};

export const refreshToken = async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const { refreshToken: token, refreshTokenId } = req.body;
    if (!token) return fail(res, 'Refresh token required', 400);
    const data = await authService.refreshToken({ token, refreshTokenId, authHeader: req.headers.authorization, meta: getRequestMeta(req) });
    return ok(res, data);
  } catch (err) { next(err); }
};

export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const { refreshToken: token, refreshTokenId, all } = req.body;
    await authService.logout({ token, refreshTokenId, all, authHeader: req.headers.authorization });
    return ok(res, undefined, all ? 'All sessions revoked' : 'Logged out successfully');
  } catch (err) { next(err); }
};

export const setAppPin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    await authService.setAppPin(req.user!.id, req.body.pin, getRequestMeta(req));
    return ok(res, undefined, 'App PIN set successfully', 201);
  } catch (err) { next(err); }
};

export const verifyAppPin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    await authService.verifyAppPin(req.user!.id, req.body.pin, getRequestMeta(req));
    return ok(res, undefined, 'PIN verified');
  } catch (err) { next(err); }
};

export const changeAppPin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    await authService.changeAppPin(req.user!.id, req.body.old_pin, req.body.new_pin, getRequestMeta(req));
    return ok(res, undefined, 'App PIN changed successfully');
  } catch (err) { next(err); }
};
