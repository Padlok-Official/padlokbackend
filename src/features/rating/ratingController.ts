import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../types';
import { ratingService } from './ratingService';
import { ok } from '../../utils/respond';

export const submitRating = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const { rating, comment } = req.body;
    const data = await ratingService.submitRating({
      transactionId: req.params.transactionId,
      reviewerId: req.user!.id,
      rating,
      comment,
      meta: { ip_address: req.ip, user_agent: req.headers['user-agent'] },
    });
    return ok(res, data, 'Rating submitted successfully', 201);
  } catch (err) { next(err); }
};

export const getTransactionRatings = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const data = await ratingService.getTransactionRatings(req.params.transactionId);
    return ok(res, data);
  } catch (err) { next(err); }
};

export const getUserRatings = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const data = await ratingService.getUserRatings(req.params.userId, limit, offset);
    return ok(res, data);
  } catch (err) { next(err); }
};

export const getMyRatingSummary = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void | Response> => {
  try {
    const data = await ratingService.getUserSummary(req.user!.id);
    return ok(res, data);
  } catch (err) { next(err); }
};
