import logger from '../../utils/logger';
import { Queue, Worker, Job } from 'bullmq';
import { redisConnection } from '../../config/redis';
import admin from '../../config/firebaseConfig';

let queue: Queue | null = null;
let worker: Worker | null = null;

function getQueue(): Queue {
    if (!queue) {
        queue = new Queue('notifications', {
            connection: redisConnection as any,
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
                    notification: { title, body },
                    data: data || {},
                    tokens,
                };

                try {
                    const response = await admin.messaging().sendEachForMulticast(message);
                    logger.info(`Sent ${response.successCount} messages (batch ${job.id})`);

                    if (response.failureCount > 0) {
                        logger.warn(`Failed ${response.failureCount} tokens in batch ${job.id}`);
                    }
                } catch (error) {
                    logger.error({ err: error, jobId: job.id }, 'Error sending batch');
                    throw error;
                }
            },
            { connection: redisConnection as any },
        );

        worker.on('completed', (job) => {
            logger.info(`Notification job ${job.id} completed`);
        });

        worker.on('failed', (job, err) => {
            logger.error(`Notification job ${job?.id} failed: ${err.message}`);
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
