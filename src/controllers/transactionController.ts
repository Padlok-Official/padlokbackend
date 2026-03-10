import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database';
import {
  WalletModel,
  AuditLogModel,
} from '../models';
import { TransactionModel } from '../models/Transaction';
import { UserModel } from '../models';
import { PaymentMethodModel } from '../models';
import { paystackService } from '../services/paystackService';
import { AuthenticatedRequest, Wallet } from '../types';

type WalletRequest = AuthenticatedRequest & { wallet?: Wallet };

/**
 * POST /api/v1/transactions/deposit
 * Initiate a deposit via Paystack.
 */
export const initiateDeposit = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { amount, callback_url } = req.body;
    const wallet = req.wallet!;
    const reference = `padlok_dep_${uuidv4()}`;
    const amountInKobo = Math.round(parseFloat(amount) * 100);

    const paystackResult = await paystackService.initializeTransaction({
      email: req.user!.email,
      amount: amountInKobo,
      reference,
      callback_url,
      metadata: {
        wallet_id: wallet.id,
        user_id: req.user!.id,
        type: 'deposit',
      },
    });

    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const transaction = await TransactionModel.create(client, {
        type: 'deposit',
        status: 'pending',
        reference,
        amount,
        user_id: req.user!.id,
        paystack_reference: paystackResult.reference,
        metadata: { wallet_id: wallet.id },
      });
      await client.query('COMMIT');

      await AuditLogModel.log({
        user_id: req.user!.id,
        action: 'deposit_initiated',
        entity_type: 'transaction',
        entity_id: transaction.id,
        details: { amount, reference },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      return res.status(200).json({
        success: true,
        message: 'Deposit initialized',
        data: {
          transaction_id: transaction.id,
          reference: transaction.reference,
          status: transaction.status,
          amount,
          authorization_url: paystackResult.authorization_url,
          access_code: paystackResult.access_code,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/transactions/withdraw
 * Initiate a withdrawal via Paystack transfer.
 */
export const initiateWithdrawal = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { amount, payment_method_id } = req.body;
    const wallet = req.wallet!;
    const reference = `padlok_wdr_${uuidv4()}`;

    // Verify payment method belongs to this wallet
    const paymentMethod = await PaymentMethodModel.findById(payment_method_id);
    if (!paymentMethod || paymentMethod.wallet_id !== wallet.id) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found',
      });
    }

    if (paymentMethod.type !== 'bank_account') {
      return res.status(400).json({
        success: false,
        message: 'Withdrawals are only supported to bank accounts',
      });
    }

    // Check spending limits
    const limitCheck = await WalletModel.checkSpendingLimits(wallet.id, amount);
    if (!limitCheck.allowed) {
      return res.status(400).json({ success: false, message: limitCheck.reason });
    }

    const pool = db.getPool()!;
    const client = await pool.connect();
    let transaction;

    try {
      await client.query('BEGIN');

      await WalletModel.resetSpendingIfNeeded(client, wallet.id);
      await WalletModel.debitBalance(client, wallet.id, amount);

      transaction = await TransactionModel.create(client, {
        type: 'withdrawal',
        status: 'pending',
        reference,
        amount,
        user_id: req.user!.id,
        payment_method_id,
        metadata: { wallet_id: wallet.id },
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof Error && err.message === 'Insufficient wallet balance') {
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
      }
      throw err;
    } finally {
      client.release();
    }

    // Initiate Paystack transfer
    try {
      const amountInKobo = Math.round(parseFloat(amount) * 100);
      const transferResult = await paystackService.initiateTransfer({
        amount: amountInKobo,
        recipient: (paymentMethod as any).paystack_recipient_code,
        reference,
        reason: 'Padlok wallet withdrawal',
      });

      // Update with Paystack reference
      if (transferResult?.transfer_code) {
        await TransactionModel.setPaystackReference(transaction.id, transferResult.transfer_code);
      }
    } catch (transferErr) {
      // Reverse the debit if Paystack transfer fails
      const reverseClient = await pool.connect();
      try {
        await reverseClient.query('BEGIN');
        await WalletModel.creditBalance(reverseClient, wallet.id, amount);
        await TransactionModel.updateStatus(reverseClient, transaction.id, 'failed');
        await reverseClient.query('COMMIT');
      } catch (reverseErr) {
        await reverseClient.query('ROLLBACK');
        console.error('Failed to reverse withdrawal debit:', reverseErr);
      } finally {
        reverseClient.release();
      }
      throw transferErr;
    }

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: 'withdrawal_initiated',
      entity_type: 'transaction',
      entity_id: transaction.id,
      details: { amount, reference, payment_method_id },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Withdrawal initiated successfully',
      data: {
        transaction_id: transaction.id,
        reference: transaction.reference,
        status: 'pending',
        amount,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/transactions/escrow
 * Initiate an escrow transaction. Funds are locked from sender's wallet.
 */
export const initiateEscrow = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { receiver_email, item_description, item_photos, amount, delivery_window } = req.body;
    const senderWallet = req.wallet!;
    const reference = `padlok_esc_${uuidv4()}`;

    // Find receiver
    const receiver = await UserModel.findByEmail(receiver_email);
    if (!receiver) {
      return res.status(404).json({ success: false, message: 'Receiver not found' });
    }

    if (receiver.id === req.user!.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot initiate an escrow with yourself',
      });
    }

    const receiverWallet = await WalletModel.findByUserId(receiver.id);
    if (!receiverWallet) {
      return res.status(400).json({
        success: false,
        message: 'Receiver does not have a wallet',
      });
    }

    // Check spending limits
    const limitCheck = await WalletModel.checkSpendingLimits(senderWallet.id, amount);
    if (!limitCheck.allowed) {
      return res.status(400).json({ success: false, message: limitCheck.reason });
    }

    const pool = db.getPool()!;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Reset spending if needed
      await WalletModel.resetSpendingIfNeeded(client, senderWallet.id);

      // Debit sender's wallet (lock funds)
      await WalletModel.debitBalance(client, senderWallet.id, amount);

      // Create escrow transaction as funded (funds are immediately locked)
      const transaction = await TransactionModel.create(client, {
        type: 'escrow',
        status: 'funded',
        reference,
        amount,
        user_id: req.user!.id,
        receiver_id: receiver.id,
        item_description,
        item_photos,
        delivery_window,
        metadata: {
          sender_wallet_id: senderWallet.id,
          receiver_wallet_id: receiverWallet.id,
        },
      });

      await client.query('COMMIT');

      await AuditLogModel.log({
        user_id: req.user!.id,
        action: 'escrow_initiated',
        entity_type: 'transaction',
        entity_id: transaction.id,
        details: { amount, receiver_id: receiver.id, reference },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      return res.status(201).json({
        success: true,
        message: 'Escrow transaction initiated. Funds locked.',
        data: {
          transaction_id: transaction.id,
          reference: transaction.reference,
          type: 'escrow',
          status: 'funded',
          amount,
          receiver_email,
          item_description,
          item_photos,
          delivery_window,
          created_at: transaction.created_at,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof Error && err.message === 'Insufficient wallet balance') {
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/transactions/:id/confirm-delivery
 * Receiver confirms they have delivered the item. Starts the delivery window countdown.
 */
export const confirmDelivery = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const transaction = await TransactionModel.findById(req.params.id);

    if (!transaction || transaction.type !== 'escrow') {
      return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
    }

    if (transaction.receiver_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Only the receiver can confirm delivery' });
    }

    if (transaction.status !== 'funded') {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm delivery. Current status: ${transaction.status}`,
      });
    }

    // Compute delivery deadline from delivery_window or default to 1 hour
    const pool = db.getPool()!;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Use the delivery_window interval to calculate deadline
      let deliveryDeadline: Date;
      if (transaction.delivery_window) {
        const { rows } = await client.query<{ deadline: Date }>(
          `SELECT (NOW() + $1::interval) AS deadline`,
          [transaction.delivery_window]
        );
        deliveryDeadline = rows[0].deadline;
      } else {
        deliveryDeadline = new Date(Date.now() + 60 * 60 * 1000); // Default 1 hour
      }

      await TransactionModel.updateStatus(client, transaction.id, 'delivery_confirmed', {
        delivery_confirmed_at: new Date(),
        delivery_deadline: deliveryDeadline,
      });

      await client.query('COMMIT');

      await AuditLogModel.log({
        user_id: req.user!.id,
        action: 'delivery_confirmed',
        entity_type: 'transaction',
        entity_id: transaction.id,
        details: { delivery_deadline: deliveryDeadline.toISOString() },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      return res.status(200).json({
        success: true,
        message: 'Delivery confirmed. Sender has until the deadline to confirm receipt or raise a dispute.',
        data: {
          delivery_deadline: deliveryDeadline,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/transactions/:id/confirm-receipt
 * Sender confirms receipt. Funds are released to the receiver.
 */
export const confirmReceipt = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const transaction = await TransactionModel.findById(req.params.id);

    if (!transaction || transaction.type !== 'escrow') {
      return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
    }

    if (transaction.user_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Only the sender can confirm receipt' });
    }

    if (transaction.status !== 'delivery_confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm receipt. Current status: ${transaction.status}`,
      });
    }

    const receiverWalletId = (transaction.metadata as any)?.receiver_wallet_id;
    if (!receiverWalletId) {
      return res.status(500).json({ success: false, message: 'Receiver wallet not found in transaction metadata' });
    }

    const pool = db.getPool()!;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Credit receiver's wallet
      await WalletModel.creditBalance(client, receiverWalletId, transaction.amount);

      // Update transaction status
      await TransactionModel.updateStatus(client, transaction.id, 'completed', {
        receiver_confirmed_at: new Date(),
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: 'receipt_confirmed',
      entity_type: 'transaction',
      entity_id: transaction.id,
      details: { amount: transaction.amount, receiver_id: transaction.receiver_id },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Receipt confirmed. Funds released to receiver.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/transactions/:id/cancel
 * Cancel an escrow transaction (only if initiated, not yet funded).
 */
export const cancelTransaction = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const transaction = await TransactionModel.findById(req.params.id);

    if (!transaction || transaction.type !== 'escrow') {
      return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
    }

    if (transaction.user_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Only the sender can cancel' });
    }

    if (transaction.status !== 'initiated') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel. Current status: ${transaction.status}. Funds are already locked.`,
      });
    }

    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await TransactionModel.updateStatus(client, transaction.id, 'cancelled');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return res.status(200).json({
      success: true,
      message: 'Escrow transaction cancelled',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/transactions
 * List all transactions for the authenticated user with filtering.
 */
export const getTransactions = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const result = await TransactionModel.findByUserId(req.user!.id, {
      type: req.query.type as any,
      status: req.query.status as any,
      limit,
      offset,
      from: req.query.from ? new Date(req.query.from as string) : undefined,
      to: req.query.to ? new Date(req.query.to as string) : undefined,
    });

    return res.status(200).json({
      success: true,
      data: {
        transactions: result.transactions,
        pagination: {
          page,
          limit,
          total: result.total,
          total_pages: Math.ceil(result.total / limit),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/transactions/:id
 * Get single transaction detail.
 */
export const getTransactionById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const transaction = await TransactionModel.findById(req.params.id);

    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaction not found' });
    }

    // Only the sender or receiver can view
    if (transaction.user_id !== req.user!.id && transaction.receiver_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    return res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (err) {
    next(err);
  }
};
