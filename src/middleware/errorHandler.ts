import logger from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';

export const errorHandler = (
  err: Error & { statusCode?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
): Response => {
  const statusCode = err.statusCode ?? 500;
  const message =
    process.env.NODE_ENV === 'production' && statusCode >= 500
      ? 'Internal server error'
      : err.message;

  if (statusCode >= 500) {
    logger.error({ data: err }, 'Server error');
  }

  const extra = err instanceof AppError ? err.extra : undefined;
  return res.status(statusCode).json({
    success: false,
    message,
    ...extra,
  });
};
