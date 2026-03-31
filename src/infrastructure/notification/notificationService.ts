import logger from '../../utils/logger';
import admin from '../../config/firebaseConfig';
import { UserModel } from '../../models/User';
import { notificationQueue } from './notificationQueue';

export const NotificationService = {
    async broadcastNotification(
        title: string,
        body: string,
        navigationPayload?: { screen: string; params?: any }
    ): Promise<{ success: boolean; messageId?: string }> {
        // Topic messaging is much more scalable for global broadcasts
        const message: any = {
            notification: {
                title,
                body,
            },
            topic: 'all_users',
            data: navigationPayload
                ? {
                    screen: navigationPayload.screen,
                    params: navigationPayload.params ? JSON.stringify(navigationPayload.params) : '',
                }
                : {},
        };

        try {
            const response = await admin.messaging().send(message);
            logger.info({ data: response }, 'Successfully sent broadcast message');
            return { success: true, messageId: response };
        } catch (error) {
            logger.error({ data: error }, 'Error sending broadcast');
            throw error;
        }
    },

    async sendToUser(
        userId: string,
        title: string,
        body: string,
        navigationPayload?: { screen: string; params?: any }
    ): Promise<boolean> {
        const user = await UserModel.findById(userId);
        if (!user || !user.fcm_token) return false;

        const data = navigationPayload
            ? {
                screen: navigationPayload.screen,
                params: navigationPayload.params ? JSON.stringify(navigationPayload.params) : '',
            }
            : {};

        await notificationQueue.add(`single-${userId}-${Date.now()}`, {
            tokens: [user.fcm_token],
            title,
            body,
            data,
        });

        return true;
    }
};
