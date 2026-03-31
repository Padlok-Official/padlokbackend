import logger from '../../utils/logger';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import admin from '../../config/firebaseConfig';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;

function getConnection(): IORedis {
    if (!connection) {
        connection = new IORedis(REDIS_URL, {
            maxRetriesPerRequest: null,
            lazyConnect: true,
        });
        connection.on('error', (err) => {
            logger.error(`Redis connection error: `);
        });
    }
    return connection;
}

function getQueue(): Queue {
    if (!queue) {
        queue = new Queue('notifications', {
            connection: getConnection() as any,
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
    }
    return queue;
}

function getWorker(): Worker {
    if (!worker) {
        worker = new Worker(
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
                    logger.info(`Successfully sent ${response.successCount} messages to batch ${job.id}`);

                    if (response.failureCount > 0) {
                        const failedTokens: string[] = [];
                        response.responses.forEach((resp, idx) => {
                            if (!resp.success) {
                                failedTokens.push(tokens[idx]);
                            }
                        });
                        logger.warn(`Failed to send to ${response.failureCount} tokens in batch ${job.id}`);
                    }
                } catch (error) {
                    logger.error({ err: error, jobId: job.id }, "Error sending batch");
                    throw error;
                }
            },
            { connection: getConnection() as any }
        );

        worker.on('completed', (job) => {
            logger.info(`Notification job ${job.id} completed`);
        });

        worker.on('failed', (job, err) => {
            logger.error(`Notification job ${job?.id} failed with error: ${err.message}`);
        });
    }
    return worker;
}

export const notificationQueue = {
    async add(name: string, data: any) {
        try {
            return await getQueue().add(name, data);
        } catch (err) {
            logger.error({ err }, 'Failed to enqueue notification (Redis may be unavailable)');
            return null;
        }
    },
};

export const notificationWorker = {
    start: () => getWorker(),
};
