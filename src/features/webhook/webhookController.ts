import logger from '../../utils/logger';
import { Request, Response } from 'express';
import db from '../../config/database';
import { WalletModel, WalletTransactionModel, EscrowTransactionModel, PaymentMethodModel, AuditLogModel } from '../../models';
import { paystackService, PaystackService } from '../../infrastructure/paystack/paystackService';
import { paystackQueue } from '../../config/queue';
import { PaystackWebhookEvent } from '../../types';

/**
 * POST /api/v1/webhooks/paystack
 * Handle Paystack webhook events.
 * Validates HMAC-SHA512 signature before processing.
 */
export const paystackWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  const signature = req.headers['x-paystack-signature'] as string;

  if (!signature) {
    res.status(401).json({ success: false, message: 'Missing signature' });
    return;
  }

  // Validate webhook signature
  const rawBody = req.body;
  if (!PaystackService.validateWebhookSignature(rawBody, signature)) {
    res.status(401).json({ success: false, message: 'Invalid signature' });
    return;
  }

  // Respond immediately to prevent Paystack retries
  res.status(200).json({ success: true });

  // Process the event asynchronously via BullMQ
  try {
    const rawData = rawBody.toString();
    const event: PaystackWebhookEvent = JSON.parse(rawData);
    
    // Add job to the queue
    await paystackQueue.add(event.event, event, {
      jobId: `paystack_wh_${event.event}_${event.data.reference || Date.now()}`,
    });
    
    logger.info(`Webhook event ${event.event} added to background queue`);
  } catch (err) {
    logger.error({ data: err }, 'Failed to queue webhook event');
  }
};

