import logger from '../../utils/logger';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { WalletModel, AuditLogModel, PaymentMethodModel } from '../../models';
import { TransactionModel } from '../../models/Transaction';
import { paystackService } from '../../infrastructure/paystack/paystackService';
import { withTransaction } from '../../utils/withTransaction';
import { AppError } from '../../utils/AppError';

const SALT_ROUNDS = 12;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_DURATION_MS = 30 * 60 * 1000;

export const walletService = {
  async setPin(userId: string, pin: string, meta: { ip_address?: string | undefined; user_agent?: string | undefined }) {
    const wallet = await WalletModel.findByUserIdWithPin(userId);
    if (!wallet) throw new AppError('Wallet not found', 404);
    if (wallet.pin_hash) throw new AppError('PIN already set. Use the change PIN endpoint to update it.', 400);

    const pinHash = await bcrypt.hash(pin, SALT_ROUNDS);
    await WalletModel.setPin(wallet.id, pinHash);

    await AuditLogModel.log({ user_id: userId, action: 'pin_set', entity_type: 'wallet', entity_id: wallet.id, ...meta });
  },

  async changePin(userId: string, oldPin: string, newPin: string, meta: { ip_address?: string | undefined; user_agent?: string | undefined }) {
    const wallet = await WalletModel.findByUserIdWithPin(userId);
    if (!wallet?.pin_hash) throw new AppError('No PIN set. Use the set PIN endpoint first.', 400);

    if (wallet.pin_locked_until && new Date(wallet.pin_locked_until) > new Date()) {
      throw new AppError('PIN locked due to too many failed attempts. Try again later.', 429);
    }

    const valid = await bcrypt.compare(oldPin, wallet.pin_hash);
    if (!valid) {
      const attempts = await WalletModel.incrementPinAttempts(wallet.id);
      if (attempts >= PIN_MAX_ATTEMPTS) {
        await WalletModel.lockPin(wallet.id, new Date(Date.now() + PIN_LOCK_DURATION_MS));
      }
      throw new AppError('Current PIN is incorrect', 401, { remaining_attempts: Math.max(0, PIN_MAX_ATTEMPTS - attempts) });
    }

    await WalletModel.resetPinAttempts(wallet.id);
    await WalletModel.setPin(wallet.id, await bcrypt.hash(newPin, SALT_ROUNDS));
    await AuditLogModel.log({ user_id: userId, action: 'pin_changed', entity_type: 'wallet', entity_id: wallet.id, ...meta });
  },

  async fundWallet(params: {
    userId: string;
    email: string;
    walletId: string;
    walletBalance: string;
    amount: string;
    callbackUrl?: string;
    ip_address?: string | undefined;
    user_agent?: string | undefined;
  }) {
    const reference = `padlok_fund_${uuidv4()}`;
    const amountInKobo = Math.round(parseFloat(params.amount) * 100);

    const paystackResult = await paystackService.initializeTransaction({
      email: params.email,
      amount: amountInKobo,
      reference,
      callback_url: params.callbackUrl,
      metadata: { wallet_id: params.walletId, user_id: params.userId, type: 'wallet_funding' },
    });

    const wallet = await WalletModel.findById(params.walletId);
    await withTransaction(async (client) => {
      await TransactionModel.create(client, {
        type: 'deposit',
        amount: params.amount,
        user_id: params.userId,
        status: 'pending',
        reference,
        paystack_reference: paystackResult.reference,
        item_description: 'Wallet funding via Paystack',
        currency: wallet?.currency,
        metadata: { wallet_id: params.walletId, balance_before: params.walletBalance, source: 'wallet_funding' },
      });
    });

    await AuditLogModel.log({
      user_id: params.userId,
      action: 'fund_initiated',
      entity_type: 'wallet',
      entity_id: params.walletId,
      details: { amount: params.amount, reference },
      ip_address: params.ip_address,
      user_agent: params.user_agent,
    });

    return {
      authorization_url: paystackResult.authorization_url,
      access_code: paystackResult.access_code,
      reference: paystackResult.reference,
    };
  },

  async verifyFunding(params: {
    userId: string;
    walletId: string;
    reference: string;
  }) {
    const transaction = await TransactionModel.findByReference(params.reference);
    if (!transaction || transaction.user_id !== params.userId) {
      throw new AppError('Transaction not found', 404);
    }

    if (transaction.status === 'completed') {
      return { status: 'completed', amount: transaction.amount, reference: transaction.reference };
    }
    if (transaction.status === 'failed') {
      return { status: 'failed', reference: transaction.reference };
    }

    const paystackRef = transaction.paystack_reference || params.reference;
    let verified: Awaited<ReturnType<typeof paystackService.verifyTransaction>>;
    try {
      verified = await paystackService.verifyTransaction(paystackRef);
    } catch {
      return { status: 'pending', reference: transaction.reference };
    }

    if (verified.status === 'success') {
      await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT status FROM transactions WHERE id = $1 FOR UPDATE`,
          [transaction.id],
        );
        if (rows[0]?.status === 'pending') {
          const amountInNaira = (verified.amount / 100).toFixed(4);
          const balanceResult = await WalletModel.creditBalance(client, params.walletId, amountInNaira);
          await TransactionModel.updateStatus(client, transaction.id, 'completed', {
            metadata: { ...transaction.metadata, balance_after: balanceResult.balance_after },
          });
        }
      });
      return { status: 'completed', amount: (verified.amount / 100).toFixed(2), reference: transaction.reference };
    }

    return {
      status: verified.status === 'abandoned' ? 'cancelled' : 'pending',
      reference: transaction.reference,
    };
  },

  async withdraw(params: {
    userId: string;
    walletId: string;
    amount: string;
    paymentMethodId: string;
    ip_address?: string | undefined;
    user_agent?: string | undefined;
  }) {
    const paymentMethod = await PaymentMethodModel.findById(params.paymentMethodId);
    if (!paymentMethod || paymentMethod.wallet_id !== params.walletId) {
      throw new AppError('Payment method not found', 404);
    }
    if (paymentMethod.type !== 'bank_account') {
      throw new AppError('Withdrawals are only supported to bank accounts', 400);
    }

    const limitCheck = await WalletModel.checkSpendingLimits(params.walletId, params.amount);
    if (!limitCheck.allowed) throw new AppError(limitCheck.reason!, 400);

    const withdrawWallet = await WalletModel.findById(params.walletId);
    const reference = `padlok_withdraw_${uuidv4()}`;
    let transaction: Awaited<ReturnType<typeof TransactionModel.create>>;

    try {
      const result = await withTransaction(async (client) => {
        await WalletModel.resetSpendingIfNeeded(client, params.walletId);
        const balanceResult = await WalletModel.debitBalance(client, params.walletId, params.amount);
        const tx = await TransactionModel.create(client, {
          type: 'withdrawal',
          amount: params.amount,
          user_id: params.userId,
          status: 'pending',
          reference,
          payment_method_id: params.paymentMethodId,
          item_description: `Withdrawal to ${paymentMethod.provider || 'bank'} - ****${(paymentMethod as any).last_four || ''}`,
          currency: withdrawWallet?.currency,
          metadata: {
            wallet_id: params.walletId,
            balance_before: balanceResult.balance_before,
            balance_after: balanceResult.balance_after,
          },
        });
        return tx;
      });
      transaction = result;
    } catch (err) {
      if (err instanceof Error && err.message === 'Insufficient wallet balance') {
        throw new AppError('Insufficient wallet balance', 400);
      }
      throw err;
    }

    try {
      await paystackService.initiateTransfer({
        amount: Math.round(parseFloat(params.amount) * 100),
        recipient: (paymentMethod as any).paystack_recipient_code,
        reference,
        reason: 'Padlok wallet withdrawal',
      });
    } catch (transferErr) {
      // Reverse the debit if Paystack transfer fails
      await withTransaction(async (client) => {
        await WalletModel.creditBalance(client, params.walletId, params.amount);
        await TransactionModel.updateStatus(client, transaction.id, 'failed');
      }).catch((err) => logger.error({ data: err }, 'Failed to reverse withdrawal debit'));
      throw transferErr;
    }

    await AuditLogModel.log({
      user_id: params.userId,
      action: 'withdrawal_initiated',
      entity_type: 'wallet',
      entity_id: params.walletId,
      details: { amount: params.amount, reference, payment_method_id: params.paymentMethodId },
      ip_address: params.ip_address,
      user_agent: params.user_agent,
    });

    return { reference, amount: params.amount };
  },

  async updateSpendingLimits(params: {
    userId: string;
    walletId: string;
    dailyLimit?: string;
    monthlyLimit?: string;
    ip_address?: string | undefined;
    user_agent?: string | undefined;
  }) {
    await WalletModel.updateLimits(params.walletId, params.dailyLimit, params.monthlyLimit);
    await AuditLogModel.log({
      user_id: params.userId,
      action: 'limits_updated',
      entity_type: 'wallet',
      entity_id: params.walletId,
      details: { daily_limit: params.dailyLimit, monthly_limit: params.monthlyLimit },
      ip_address: params.ip_address,
      user_agent: params.user_agent,
    });
  },
};
