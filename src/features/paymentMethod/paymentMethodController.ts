import { Response, NextFunction } from 'express';
import { PaymentMethodModel } from '../../models';
import { paystackService } from '../../infrastructure/paystack/paystackService';
import { paymentMethodService } from './paymentMethodService';
import { WalletRequest } from '../../types';
import { ok, getRequestMeta } from '../../utils/respond';

export const addBankAccount = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const data = await paymentMethodService.addBankAccount({
      userId: req.user!.id,
      walletId: req.wallet!.id,
      bankCode: req.body.bank_code,
      accountNumber: req.body.account_number,
      meta: getRequestMeta(req),
    });
    return ok(res, data, 'Bank account added successfully', 201);
  } catch (err) { next(err); }
};

export const addMobileMoney = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const data = await paymentMethodService.addMobileMoney({
      userId: req.user!.id,
      walletId: req.wallet!.id,
      provider: req.body.provider,
      phoneNumber: req.body.phone_number,
      accountName: req.body.account_name,
      meta: getRequestMeta(req),
    });
    return ok(res, data, 'Mobile money account added successfully', 201);
  } catch (err) { next(err); }
};

export const getPaymentMethods = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const methods = await PaymentMethodModel.findByWalletId(req.wallet!.id);
    return ok(res, methods);
  } catch (err) { next(err); }
};

export const setDefault = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    await paymentMethodService.setDefault(req.wallet!.id, req.params.id);
    return ok(res, undefined, 'Default payment method updated');
  } catch (err) { next(err); }
};

export const deletePaymentMethod = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    await paymentMethodService.deletePaymentMethod(req.user!.id, req.wallet!.id, req.params.id, getRequestMeta(req));
    return ok(res, undefined, 'Payment method removed');
  } catch (err) { next(err); }
};

export const verifyAccount = async (req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const data = await paymentMethodService.verifyAccount({
      accountNumber: req.body.account_number,
      bankCode: req.body.bank_code,
    });
    return ok(res, data, 'Account verified successfully');
  } catch (err) { next(err); }
};

export const listBanks = async (_req: WalletRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const banks = await paystackService.listBanks();
    return ok(res, banks);
  } catch (err) { next(err); }
};
