import { Response, NextFunction } from 'express';
import { TransactionModel } from '../../models/Transaction';
import { walletService } from '../wallet/walletService';
import { AuthenticatedRequest, WalletRequest } from '../../types';
import { ok, fail, paginated, getRequestMeta } from '../../utils/respond';
import { parsePagination } from '../../utils/pagination';

export const initiateDeposit = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
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
    return ok(res, data, 'Deposit initialized');
  } catch (err) { next(err); }
};

export const initiateWithdrawal = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
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

export const getTransactions = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const { page, limit, offset } = parsePagination(req);
    const result = await TransactionModel.findByUserId(req.user!.id, {
      type: req.query.type as any,
      status: req.query.status as any,
      limit,
      offset,
      from: req.query.from ? new Date(req.query.from as string) : undefined,
      to: req.query.to ? new Date(req.query.to as string) : undefined,
      activeToday: req.query.todayOnly === 'true',
    });
    return paginated(res, 'transactions', result.transactions, result.total, page, limit);
  } catch (err) { next(err); }
};

export const getTransactionById = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const transaction = await TransactionModel.findById(req.params.id);
    if (!transaction) return fail(res, 'Transaction not found', 404);
    if (transaction.user_id !== req.user!.id && transaction.receiver_id !== req.user!.id) {
      return fail(res, 'Access denied', 403);
    }
    return ok(res, transaction);
  } catch (err) { next(err); }
};
