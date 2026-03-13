import { Request, Response, NextFunction } from 'express';
import { NotificationService } from '../services/notificationService';

export const broadcastNotification = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void | Response> => {
    try {
        const { title, body, screen, params } = req.body;

        if (!title || !body) {
            return res.status(400).json({
                success: false,
                message: 'Title and body are required',
            });
        }

        const navigationPayload = screen ? { screen, params } : undefined;
        const result = await NotificationService.broadcastNotification(title, body, navigationPayload);

        return res.json({
            success: true,
            message: 'Broadcast notification sent successfully',
            data: result,
        });
    } catch (err) {
        next(err);
    }
};
