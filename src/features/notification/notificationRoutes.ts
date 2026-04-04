import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as controller from './notificationController';

const router = Router();

router.use(authenticate);

// GET /api/v1/notifications - Paginated notification list
router.get('/', controller.getNotifications);

// GET /api/v1/notifications/unread-count - Badge count
router.get('/unread-count', controller.getUnreadCount);

// PATCH /api/v1/notifications/read-all - Mark all as read
router.patch('/read-all', controller.markAllAsRead);

// PATCH /api/v1/notifications/:id/read - Mark single as read
router.patch('/:id/read', controller.markAsRead);

export default router;
