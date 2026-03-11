import { Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import db from "../config/database";
import { WalletModel, AuditLogModel, PaymentMethodModel } from "../models";
import { TransactionModel } from "../models/Transaction";
import { paystackService } from "../services/paystackService";
import { AuthenticatedRequest, Wallet } from "../types";

const SALT_ROUNDS = 12;

type WalletRequest = AuthenticatedRequest & { wallet?: Wallet };

/**
 * GET /api/v1/wallet
 * Get the authenticated user's wallet.
 */
export const getWallet = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    return res.status(200).json({
      success: true,
      data: req.wallet,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/wallet/pin
 * Set transaction PIN for the first time.
 */
export const setPin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const { pin } = req.body;
    const wallet = await WalletModel.findByUserIdWithPin(req.user!.id);

    if (!wallet) {
      return res
        .status(404)
        .json({ success: false, message: "Wallet not found" });
    }

    if (wallet.pin_hash) {
      return res.status(400).json({
        success: false,
        message: "PIN already set. Use the change PIN endpoint to update it.",
      });
    }

    const pinHash = await bcrypt.hash(pin, SALT_ROUNDS);
    await WalletModel.setPin(wallet.id, pinHash);

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: "pin_set",
      entity_type: "wallet",
      entity_id: wallet.id,
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "Transaction PIN set successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/wallet/pin
 * Change existing transaction PIN.
 */
export const changePin = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const { old_pin, new_pin } = req.body;
    const wallet = await WalletModel.findByUserIdWithPin(req.user!.id);

    if (!wallet?.pin_hash) {
      return res.status(400).json({
        success: false,
        message: "No PIN set. Use the set PIN endpoint first.",
      });
    }

    // Check lockout
    if (
      wallet.pin_locked_until &&
      new Date(wallet.pin_locked_until) > new Date()
    ) {
      return res.status(429).json({
        success: false,
        message: "PIN locked due to too many failed attempts. Try again later.",
      });
    }

    const valid = await bcrypt.compare(old_pin, wallet.pin_hash);
    if (!valid) {
      const attempts = await WalletModel.incrementPinAttempts(wallet.id);
      if (attempts >= 5) {
        const lockUntil = new Date(Date.now() + 30 * 60 * 1000);
        await WalletModel.lockPin(wallet.id, lockUntil);
      }
      return res.status(401).json({
        success: false,
        message: "Current PIN is incorrect",
        remaining_attempts: Math.max(0, 5 - attempts),
      });
    }

    await WalletModel.resetPinAttempts(wallet.id);
    const newPinHash = await bcrypt.hash(new_pin, SALT_ROUNDS);
    await WalletModel.setPin(wallet.id, newPinHash);

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: "pin_changed",
      entity_type: "wallet",
      entity_id: wallet.id,
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "Transaction PIN changed successfully",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/wallet/fund
 * Initialize wallet funding via Paystack.
 */
export const fundWallet = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const { amount, callback_url } = req.body;
    const wallet = req.wallet!;
    const reference = `padlok_fund_${uuidv4()}`;
    const amountInKobo = Math.round(parseFloat(amount) * 100);

    const paystackResult = await paystackService.initializeTransaction({
      email: req.user!.email,
      amount: amountInKobo,
      reference,
      callback_url,
      metadata: {
        wallet_id: wallet.id,
        user_id: req.user!.id,
        type: "wallet_funding",
      },
    });

    // Create pending wallet transaction
    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await TransactionModel.create(client, {
        type: "deposit",
        amount,
        user_id: req.user!.id,
        status: "pending",
        reference,
        paystack_reference: paystackResult.reference,
        item_description: "Wallet funding via Paystack",
        metadata: { 
          wallet_id: wallet.id,
          balance_before: wallet.balance,
          source: 'wallet_funding'
        },
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: "fund_initiated",
      entity_type: "wallet",
      entity_id: wallet.id,
      details: { amount, reference },
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "Payment initialized",
      data: {
        authorization_url: paystackResult.authorization_url,
        access_code: paystackResult.access_code,
        reference: paystackResult.reference,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/wallet/fund/verify/:reference
 * Verify a wallet funding transaction.
 * Checks Paystack status and credits wallet if not already credited by webhook.
 */
export const verifyFunding = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const { reference } = req.params;
    const wallet = req.wallet!;

    // Find the transaction by reference in the unified table
    const transaction = await TransactionModel.findByReference(reference);

    if (!transaction || transaction.user_id !== req.user!.id) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    // If already completed (e.g. by webhook), return success immediately
    if (transaction.status === "completed") {
      return res.status(200).json({
        success: true,
        message: "Transaction already completed",
        data: {
          status: "completed",
          amount: transaction.amount,
          reference: transaction.reference,
        },
      });
    }

    if (transaction.status === "failed") {
      return res.status(200).json({
        success: true,
        data: {
          status: "failed",
          reference: transaction.reference,
        },
      });
    }

    // Transaction still pending — verify with Paystack
    const paystackRef = transaction.paystack_reference || reference;
    let verified;
    try {
      verified = await paystackService.verifyTransaction(paystackRef);
    } catch {
      // Paystack verification failed, transaction is still pending
      return res.status(200).json({
        success: true,
        data: {
          status: "pending",
          reference: transaction.reference,
        },
      });
    }

    if (verified.status === "success") {
      // Credit wallet (idempotent — only if still pending)
      const pool = db.getPool()!;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Re-check status inside transaction to avoid race with webhook
        const { rows } = await client.query(
          `SELECT status FROM transactions WHERE id = $1 FOR UPDATE`,
          [transaction.id],
        );

        if (rows[0]?.status === "pending") {
          const amountInNaira = (verified.amount / 100).toFixed(4);
          const balanceResult = await WalletModel.creditBalance(
            client,
            wallet.id,
            amountInNaira,
          );
          await TransactionModel.updateStatus(
            client,
            transaction.id,
            "completed",
            {
              metadata: {
                ...transaction.metadata,
                balance_after: balanceResult.balance_after
              }
            }
          );
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      return res.status(200).json({
        success: true,
        message: "Transaction verified and completed",
        data: {
          status: "completed",
          amount: (verified.amount / 100).toFixed(2),
          reference: transaction.reference,
        },
      });
    }

    // Payment not yet successful on Paystack side
    return res.status(200).json({
      success: true,
      data: {
        status: verified.status === "abandoned" ? "cancelled" : "pending",
        reference: transaction.reference,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/wallet/withdraw
 * Withdraw from wallet to bank account.
 */
export const withdraw = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const { amount, payment_method_id } = req.body;
    const wallet = req.wallet!;
    const reference = `padlok_withdraw_${uuidv4()}`;

    // Verify payment method belongs to this wallet
    const paymentMethod = await PaymentMethodModel.findById(payment_method_id);
    if (!paymentMethod || paymentMethod.wallet_id !== wallet.id) {
      return res.status(404).json({
        success: false,
        message: "Payment method not found",
      });
    }

    if (paymentMethod.type !== "bank_account") {
      return res.status(400).json({
        success: false,
        message: "Withdrawals are only supported to bank accounts",
      });
    }

    // Check spending limits
    const limitCheck = await WalletModel.checkSpendingLimits(wallet.id, amount);
    if (!limitCheck.allowed) {
      return res.status(400).json({
        success: false,
        message: limitCheck.reason,
      });
    }

    // Atomic debit
    const pool = db.getPool()!;
    const client = await pool.connect();
    let balanceResult: { balance_before: string; balance_after: string };
    let transaction;

    try {
      await client.query("BEGIN");
      await WalletModel.resetSpendingIfNeeded(client, wallet.id);
      balanceResult = await WalletModel.debitBalance(client, wallet.id, amount);

      transaction = await TransactionModel.create(client, {
        type: "withdrawal",
        amount,
        user_id: req.user!.id,
        status: "pending",
        reference,
        payment_method_id,
        item_description: `Withdrawal to ${paymentMethod.provider || "bank"} - ****${(paymentMethod as any).last_four || ""}`,
        metadata: {
          wallet_id: wallet.id,
          balance_before: balanceResult.balance_before,
          balance_after: balanceResult.balance_after,
        },
      });

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      if (
        err instanceof Error &&
        err.message === "Insufficient wallet balance"
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Insufficient wallet balance" });
      }
      throw err;
    } finally {
      client.release();
    }

    // Initiate Paystack transfer
    try {
      const amountInKobo = Math.round(parseFloat(amount) * 100);
      await paystackService.initiateTransfer({
        amount: amountInKobo,
        recipient: (paymentMethod as any).paystack_recipient_code,
        reference,
        reason: "Padlok wallet withdrawal",
      });
    } catch (transferErr) {
      // Reverse the debit if Paystack transfer fails
      const reverseClient = await pool.connect();
      try {
        await reverseClient.query("BEGIN");
        await WalletModel.creditBalance(reverseClient, wallet.id, amount);
        if (transaction) {
          await TransactionModel.updateStatus(
            reverseClient,
            transaction.id,
            "failed",
          );
        }
        await reverseClient.query("COMMIT");
      } catch (reverseErr) {
        await reverseClient.query("ROLLBACK");
        console.error("Failed to reverse withdrawal debit:", reverseErr);
      } finally {
        reverseClient.release();
      }
      throw transferErr;
    }

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: "withdrawal_initiated",
      entity_type: "wallet",
      entity_id: wallet.id,
      details: { amount, reference, payment_method_id },
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "Withdrawal initiated successfully",
      data: { reference, amount },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/wallet/transactions
 * Get paginated transaction history.
 */
export const getTransactionHistory = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const wallet = req.wallet!;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const result = await TransactionModel.findByUserId(req.user!.id, {
      limit,
      offset,
      type: req.query.type as any,
      status: req.query.status as any,
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
 * GET /api/v1/wallet/transactions/:id
 * Get single transaction detail.
 */
export const getTransactionById = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const wallet = req.wallet!;
    const transaction = await TransactionModel.findById(req.params.id);

    if (!transaction || (transaction.user_id !== req.user!.id && transaction.receiver_id !== req.user!.id)) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: transaction,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/wallet/limits
 * Update spending limits (requires PIN).
 */
export const updateSpendingLimits = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const wallet = req.wallet!;
    const { daily_limit, monthly_limit } = req.body;

    if (!daily_limit && !monthly_limit) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one limit to update",
      });
    }

    await WalletModel.updateLimits(wallet.id, daily_limit, monthly_limit);

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: "limits_updated",
      entity_type: "wallet",
      entity_id: wallet.id,
      details: { daily_limit, monthly_limit },
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "Spending limits updated successfully",
    });
  } catch (err) {
    next(err);
  }
};
