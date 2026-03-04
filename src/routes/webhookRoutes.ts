import { Router } from 'express';
import express from 'express';
import { webhookLimiter } from '../middleware/security';
import { paystackWebhook } from '../controllers/webhookController';

const router = Router();

// Paystack webhook needs raw body for HMAC signature verification
router.post(
  '/paystack',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  paystackWebhook
);

export default router;
