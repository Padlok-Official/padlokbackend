import { Request } from 'express';

export function parsePagination(req: Request, defaultLimit = 20): { page: number; limit: number; offset: number } {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || defaultLimit);
  return { page, limit, offset: (page - 1) * limit };
}
