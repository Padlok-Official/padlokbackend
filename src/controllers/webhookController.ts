import { Request, Response } from 'express';
import { PaystackService } from '../services/paystackService';
import { paystackQueue } from '../config/queue';

/**
 * POST /api/v1/webhooks/paystack
 * Handle Paystack webhook events.
 * Validates HMAC-SHA512 signature before queuing for asynchronous processing.
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

  // Respond immediately to Paystack to prevent timeouts and retries
  res.status(200).json({ success: true });

  // Add the event to BullMQ for background processing
  try {
    const event = JSON.parse(rawBody.toString());
    await paystackQueue.add(event.event, event);
    console.log(`Queued Paystack event: ${event.event} for async processing`);
  } catch (err) {
    console.error('Failed to queue Paystack webhook:', err);
  }
};

