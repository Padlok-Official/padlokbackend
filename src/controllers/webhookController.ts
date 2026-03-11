import { Request, Response } from 'express';
import db from '../config/database';
import { WalletModel, WalletTransactionModel, EscrowTransactionModel, PaymentMethodModel, AuditLogModel } from '../models';
import { paystackService, PaystackService } from '../services/paystackService';
import { PaystackWebhookEvent } from '../types';

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

  // Process the event asynchronously
  try {
    const event: PaystackWebhookEvent = JSON.parse(rawBody.toString());
    await processWebhookEvent(event);
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
};

async function processWebhookEvent(event: PaystackWebhookEvent): Promise<void> {
  switch (event.event) {
    case 'charge.success':
      await handleChargeSuccess(event);
      break;
    case 'transfer.success':
      await handleTransferSuccess(event);
      break;
    case 'transfer.failed':
      await handleTransferFailed(event);
      break;
    default:
      console.log(`Unhandled webhook event: ${event.event}`);
  }
}

/**
 * Handle successful charge — credit wallet for funding transactions.
 */
async function handleChargeSuccess(event: PaystackWebhookEvent): Promise<void> {
  const { reference, amount, authorization, metadata } = event.data;

  // Verify the transaction with Paystack
  let verified;
  try {
    verified = await paystackService.verifyTransaction(reference);
  } catch {
    console.error(`Failed to verify transaction ${reference}`);
    return;
  }

  if (verified.status !== 'success') return;

  const walletTx = await WalletTransactionModel.findByReference(reference);

  // Handle wallet funding
  if (walletTx && walletTx.status === 'pending' && walletTx.type === 'funding') {
    const pool = db.getPool()!;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const amountInNaira = (amount / 100).toFixed(4);
      const balanceResult = await WalletModel.creditBalance(client, walletTx.wallet_id, amountInNaira);

      await WalletTransactionModel.updateStatus(client, walletTx.id, 'completed');

      // Update balance_after on the transaction record
      await client.query(
        `UPDATE wallet_transactions SET balance_after = $1 WHERE id = $2`,
        [balanceResult.balance_after, walletTx.id]
      );

      await client.query('COMMIT');

      // Save card authorization if reusable
      if (authorization?.reusable && metadata?.wallet_id) {
        await saveCardAuthorization(
          metadata.wallet_id as string,
          authorization
        );
      }

      await AuditLogModel.log({
        action: 'wallet_funded',
        entity_type: 'wallet',
        entity_id: walletTx.wallet_id,
        details: { amount: amountInNaira, reference, paystack_reference: reference },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Failed to credit wallet for reference ${reference}:`, err);
    } finally {
      client.release();
    }
  }
}

/**
 * Handle successful transfer — mark withdrawal as completed.
 */
async function handleTransferSuccess(event: PaystackWebhookEvent): Promise<void> {
  const { reference } = event.data;

  const walletTx = await WalletTransactionModel.findByReference(reference);
  if (!walletTx || walletTx.status !== 'pending') return;

  const pool = db.getPool()!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await WalletTransactionModel.updateStatus(client, walletTx.id, 'completed');
    await client.query('COMMIT');

    await AuditLogModel.log({
      action: 'withdrawal_completed',
      entity_type: 'wallet',
      entity_id: walletTx.wallet_id,
      details: { amount: walletTx.amount, reference },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Failed to update transfer status for ${reference}:`, err);
  } finally {
    client.release();
  }
}

/**
 * Handle failed transfer — reverse the debit and mark as failed.
 */
async function handleTransferFailed(event: PaystackWebhookEvent): Promise<void> {
  const { reference } = event.data;

  const walletTx = await WalletTransactionModel.findByReference(reference);
  if (!walletTx || walletTx.status !== 'pending') return;

  const pool = db.getPool()!;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Reverse the debit
    await WalletModel.creditBalance(client, walletTx.wallet_id, walletTx.amount);
    await WalletTransactionModel.updateStatus(client, walletTx.id, 'failed');

    await client.query('COMMIT');

    await AuditLogModel.log({
      action: 'withdrawal_failed_reversed',
      entity_type: 'wallet',
      entity_id: walletTx.wallet_id,
      details: { amount: walletTx.amount, reference },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Failed to reverse withdrawal for ${reference}:`, err);
  } finally {
    client.release();
  }
}

/**
 * Save a reusable card authorization from Paystack.
 */
async function saveCardAuthorization(
  walletId: string,
  authorization: NonNullable<PaystackWebhookEvent['data']['authorization']>
): Promise<void> {
  try {
    // Check if already saved
    const existing = await PaymentMethodModel.findByPaystackAuthCode(
      authorization.authorization_code,
      walletId
    );
    if (existing) return;

    await PaymentMethodModel.create({
      wallet_id: walletId,
      type: 'card',
      provider: authorization.bank,
      account_name: `${authorization.card_type} ****${authorization.last4}`,
      last_four: authorization.last4,
      paystack_auth_code: authorization.authorization_code,
      is_default: false,
      metadata: {
        card_type: authorization.card_type,
        exp_month: authorization.exp_month,
        exp_year: authorization.exp_year,
        bin: authorization.bin,
        bank: authorization.bank,
      },
    });

    await AuditLogModel.log({
      action: 'card_saved_from_payment',
      entity_type: 'payment_method',
      details: { wallet_id: walletId, last4: authorization.last4, bank: authorization.bank },
    });
  } catch (err) {
    console.error('Failed to save card authorization:', err);
  }
}
