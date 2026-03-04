import { Response, NextFunction } from 'express';
import { WalletModel } from '../models';
import { AuthenticatedRequest, Wallet } from '../types';

export const requireWallet = async (
  req: AuthenticatedRequest & { wallet?: Wallet },
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const wallet = await WalletModel.findByUserId(req.user!.id);

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found. Please contact support.',
      });
    }

    if (wallet.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Wallet is ${wallet.status}. Please contact support.`,
      });
    }

    (req as AuthenticatedRequest & { wallet: Wallet }).wallet = wallet;
    next();
  } catch (err) {
    next(err);
  }
};
