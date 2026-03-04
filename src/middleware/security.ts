import rateLimit from 'express-rate-limit';

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const max = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;

export const generalLimiter = rateLimit({
  windowMs,
  max,
  message: { success: false, message: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const walletTransactionLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many transaction attempts. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const pinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many PIN attempts. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});
