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
      activeToday: req.query.todayOnly === 'true',
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
