import { Queue } from 'bullmq';
import { redisConnection } from './redis';

export const paystackQueue = new Queue('paystack-webhook', {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s...
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
