import { Request, Response } from 'express';

export function ok(res: Response, data?: unknown, message?: string, status = 200): Response {
  return res.status(status).json({
    success: true,
    ...(message && { message }),
    ...(data !== undefined && { data }),
  });
}

export function fail(res: Response, message: string, status: number, extra?: Record<string, unknown>): Response {
  return res.status(status).json({ success: false, message, ...extra });
}

export function paginated(
  res: Response,
  key: string,
  items: unknown[],
  total: number,
  page: number,
  limit: number,
): Response {
  return res.status(200).json({
    success: true,
    data: {
      [key]: items,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    },
  });
}

export function getRequestMeta(req: Request): { ip_address: string | undefined; user_agent: string | undefined } {
  return {
    ip_address: req.ip ?? undefined,
    user_agent: (req.headers['user-agent'] as string) ?? undefined,
  };
}
