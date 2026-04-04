import { Response, NextFunction } from 'express';
import { inAppNotificationService } from './inAppNotificationService';
import { AuthenticatedRequest } from '../../types';
import { ok, paginated } from '../../utils/respond';

export const getNotifications = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const result = await inAppNotificationService.getNotifications(req.user!.id, page, limit);
    return paginated(res, 'notifications', result.notifications, result.total, result.page, result.limit);
  } catch (err) { next(err); }
};

export const getUnreadCount = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const count = await inAppNotificationService.getUnreadCount(req.user!.id);
    return ok(res, { unread_count: count });
  } catch (err) { next(err); }
};

export const markAsRead = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    await inAppNotificationService.markAsRead(req.params.id, req.user!.id);
    return ok(res, undefined, 'Notification marked as read');
  } catch (err) { next(err); }
};

export const markAllAsRead = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const count = await inAppNotificationService.markAllAsRead(req.user!.id);
    return ok(res, { marked: count }, 'All notifications marked as read');
  } catch (err) { next(err); }
};
