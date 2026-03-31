import logger from '../utils/logger';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisConnection = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // Required for BullMQ
});

redisConnection.on('connect', () => {
  logger.info('Successfully connected to Redis');
});

redisConnection.on('error', (err) => {
  logger.error({ data: err }, 'Redis connection error');
});
