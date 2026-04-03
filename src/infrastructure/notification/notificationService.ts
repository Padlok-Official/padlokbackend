import logger from "../../utils/logger";
import admin from "../../config/firebaseConfig";
import { UserModel } from "../../models/User";

export const NotificationService = {
  async broadcastNotification(
    title: string,
    body: string,
    navigationPayload?: { screen: string; params?: any },
  ): Promise<{ success: boolean; messageId?: string }> {
    // Topic messaging is much more scalable for global broadcasts
    const message: any = {
      notification: {
        title,
        body,
      },
      topic: "all_users",
      data: navigationPayload
        ? {
            screen: navigationPayload.screen,
            params: navigationPayload.params
              ? JSON.stringify(navigationPayload.params)
              : "",
          }
        : {},
    };

    try {
      const response = await admin.messaging().send(message);
      logger.info({ data: response }, "Successfully sent broadcast message");
      return { success: true, messageId: response };
    } catch (error) {
      logger.error({ data: error }, "Error sending broadcast");
      throw error;
    }
  },

  async sendToUser(
    userId: string,
    title: string,
    body: string,
    navigationPayload?: { screen: string; params?: any },
  ): Promise<boolean> {
    const user = await UserModel.findById(userId);
    if (!user || !user.fcm_token) return false;

    const data: { [key: string]: string } = navigationPayload
      ? {
          screen: navigationPayload.screen,
          params: navigationPayload.params
            ? JSON.stringify(navigationPayload.params)
            : "",
        }
      : {};

    if (admin.apps.length === 0) {
      logger.error(
        "Firebase Admin SDK not initialized — cannot send notification",
      );
      return false;
    }

    try {
      logger.info({ userId, title }, "Sending FCM notification...");
      const response = await admin.messaging().send({
        token: user.fcm_token,
        notification: { title, body },
        data,
      });
      logger.info({ messageId: response, userId }, "Push notification sent");
      return true;
    } catch (error: any) {
      logger.error(
        { err: error, code: error.code, userId },
        "Failed to send push notification",
      );
      return false;
    }
  },
};
