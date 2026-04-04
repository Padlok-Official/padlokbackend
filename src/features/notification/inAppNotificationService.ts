import logger from '../../utils/logger';
import { NotificationModel } from '../../models';
import { NotificationService } from '../../infrastructure/notification/notificationService';
import socketService from '../../infrastructure/socket/socketService';
import { NotificationType } from '../../types';

/**
 * Central orchestrator for in-app notifications.
 *
 * Every call to `notify()` does three things atomically:
 *   1. Persists the notification to the database
 *   2. Sends a push notification via FCM (fire-and-forget)
 *   3. Emits a socket event with the new unread count for real-time badge updates
 *
 * Business logic (escrow events, payment events) should call this service
 * instead of calling NotificationService, socketService, and NotificationModel separately.
 */
export const inAppNotificationService = {
  async notify(params: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: { screen: string; params?: Record<string, string> };
  }) {
    const { userId, type, title, body, data } = params;

    // 1. Persist
    const notification = await NotificationModel.create({
      user_id: userId,
      type,
      title,
      body,
      data: data || {},
    });

    // 2. Push via FCM (non-blocking)
    NotificationService.sendToUser(userId, title, body, data).catch((err) =>
      logger.error({ err, userId }, 'FCM push failed'),
    );

    // 3. Real-time badge update via socket
    const unreadCount = await NotificationModel.countUnread(userId);
    socketService.emitToUser(userId, 'notification:new', {
      notification,
      unreadCount,
    });

    return notification;
  },

  async getNotifications(userId: string, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const [notifications, total] = await Promise.all([
      NotificationModel.findByUserId(userId, limit, offset),
      NotificationModel.countByUserId(userId),
    ]);
    return { notifications, total, page, limit };
  },

  async getUnreadCount(userId: string) {
    return NotificationModel.countUnread(userId);
  },

  async markAsRead(notificationId: string, userId: string) {
    return NotificationModel.markAsRead(notificationId, userId);
  },

  async markAllAsRead(userId: string) {
    const count = await NotificationModel.markAllAsRead(userId);
    // Emit updated badge count (now 0)
    socketService.emitToUser(userId, 'notification:new', { unreadCount: 0 });
    return count;
  },
};
