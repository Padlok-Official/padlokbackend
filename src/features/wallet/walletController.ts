import { Response, NextFunction } from 'express';
import { WalletModel } from '../../models';
import { TransactionModel } from '../../models/Transaction';
import { walletService } from './walletService';
import { WalletRequest } from '../../types';
import { ok, fail, paginated, getRequestMeta } from '../../utils/respond';
import { parsePagination } from '../../utils/pagination';

export const getWallet = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    return ok(res, req.wallet);
  } catch (err) { next(err); }
};

export const setPin = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    await walletService.setPin(req.user!.id, req.body.pin, getRequestMeta(req));
    return ok(res, undefined, 'Transaction PIN set successfully');
  } catch (err) { next(err); }
};

export const changePin = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    await walletService.changePin(req.user!.id, req.body.old_pin, req.body.new_pin, getRequestMeta(req));
    return ok(res, undefined, 'Transaction PIN changed successfully');
  } catch (err) { next(err); }
};

export const fundWallet = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const data = await walletService.fundWallet({
      userId: req.user!.id,
      email: req.user!.email,
      walletId: req.wallet!.id,
      walletBalance: req.wallet!.balance,
      amount: req.body.amount,
      callbackUrl: req.body.callback_url,
      ...getRequestMeta(req),
    });
    return ok(res, data, 'Payment initialized');
  } catch (err) { next(err); }
};

export const verifyFunding = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const data = await walletService.verifyFunding({
      userId: req.user!.id,
      walletId: req.wallet!.id,
      reference: req.params.reference,
    });
    const message = data.status === 'completed' ? 'Transaction verified and completed' : undefined;
    return ok(res, data, message);
  } catch (err) { next(err); }
};

export const withdraw = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const data = await walletService.withdraw({
      userId: req.user!.id,
      walletId: req.wallet!.id,
      amount: req.body.amount,
      paymentMethodId: req.body.payment_method_id,
      ...getRequestMeta(req),
    });
    return ok(res, data, 'Withdrawal initiated successfully');
  } catch (err) { next(err); }
};

export const getTransactionHistory = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const result = await TransactionModel.findByUserId(req.user!.id, {
      limit, offset,
      type: req.query.type as any,
      status: req.query.status as any,
      from: req.query.from ? new Date(req.query.from as string) : undefined,
      to: req.query.to ? new Date(req.query.to as string) : undefined,
    });
    return paginated(res, 'transactions', result.transactions, result.total, page, limit);
  } catch (err) { next(err); }
};

export const getTransactionById = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const transaction = await TransactionModel.findById(req.params.id);
    if (!transaction || (transaction.user_id !== req.user!.id && transaction.receiver_id !== req.user!.id)) {
      return fail(res, 'Transaction not found', 404);
    }
    return ok(res, transaction);
  } catch (err) { next(err); }
};

export const updateSpendingLimits = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const { daily_limit, monthly_limit } = req.body;
    if (!daily_limit && !monthly_limit) return fail(res, 'Provide at least one limit to update', 400);
    await walletService.updateSpendingLimits({ userId: req.user!.id, walletId: req.wallet!.id, dailyLimit: daily_limit, monthlyLimit: monthly_limit, ...getRequestMeta(req) });
    return ok(res, undefined, 'Spending limits updated successfully');
  } catch (err) { next(err); }
};
