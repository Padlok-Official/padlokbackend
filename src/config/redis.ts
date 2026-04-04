import logger from '../utils/logger';
import Redis, { RedisOptions } from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Shared Redis connection options with exponential-backoff retry.
 * Used by BullMQ workers/queues and the Socket.io adapter.
 */
const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null, // Required for BullMQ
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 10000);
    logger.warn(`Redis reconnecting (attempt ${times}), next in ${delay}ms`);
    return delay;
  },
  reconnectOnError(err: Error) {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
    return targetErrors.some((e) => err.message.includes(e));
  },
};

export const redisConnection = new Redis(redisUrl, baseOptions);

redisConnection.on('connect', () => {
  logger.info('Redis connected');
});

redisConnection.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

redisConnection.on('close', () => {
  logger.warn('Redis connection closed, reconnecting...');
});

/**
 * Create a duplicate connection (for Socket.io pub/sub or other subscribers).
 * Inherits the same retry strategy.
 */
export function createRedisClient(): Redis {
  return new Redis(redisUrl, baseOptions);
}
