import { Request, Response, NextFunction } from 'express';

export const errorHandler = (
  err: Error & { statusCode?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
): Response => {
  const statusCode = err.statusCode ?? 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message;

  if (statusCode >= 500) {
    console.error('Server error:', err);
  }

  return res.status(statusCode).json({
    success: false,
    message,
  });
};
