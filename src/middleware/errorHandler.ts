import logger from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';

export const errorHandler = (
  err: Error & { statusCode?: number },
  req: Request,
  res: Response,
  _next: NextFunction
): Response => {
  const statusCode = err.statusCode ?? 500;
  const message =
    process.env.NODE_ENV === 'production' && statusCode >= 500
      ? 'Internal server error'
      : err.message;

  if (statusCode >= 500) {
    logger.error(
      {
        err,
        method: req.method,
        url: req.originalUrl,
      },
      `${req.method} ${req.originalUrl} failed: ${err.message}`,
    );
  } else if (statusCode >= 400) {
    logger.warn(
      { statusCode, method: req.method, url: req.originalUrl },
      `${req.method} ${req.originalUrl} → ${statusCode}: ${err.message}`,
    );
  }

  const extra = err instanceof AppError ? err.extra : undefined;
  return res.status(statusCode).json({
    success: false,
    message,
    ...extra,
  });
};
