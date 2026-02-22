import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import admin from '../config/firebaseConfig';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

export const notificationQueue = new Queue('notifications', {
    connection: connection as any,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
});

export const notificationWorker = new Worker(
    'notifications',
    async (job: Job) => {
        const { tokens, title, body, data } = job.data;

        if (!tokens || tokens.length === 0) return;

        const message = {
            notification: {
                title,
                body,
            },
            data: data || {},
            tokens,
        };

        try {
            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`Successfully sent ${response.successCount} messages to batch ${job.id}`);

            if (response.failureCount > 0) {
                const failedTokens: string[] = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        failedTokens.push(tokens[idx]);
                    }
                });
                console.warn(`Failed to send to ${response.failureCount} tokens in batch ${job.id}`);
                // Here you could handle invalid tokens (e.g. remove them from DB)
            }
        } catch (error) {
            console.error(`Error sending batch ${job.id}:`, error);
            throw error; // Let BullMQ retry
        }
    },
    { connection: connection as any }
);

notificationWorker.on('completed', (job) => {
    console.log(`Notification job ${job.id} completed`);
});

notificationWorker.on('failed', (job, err) => {
    console.error(`Notification job ${job?.id} failed with error: ${err.message}`);
});
