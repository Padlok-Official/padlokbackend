import { RatingModel, AuditLogModel } from '../../models';
import { EscrowTransactionModel } from '../../models';
import { AppError } from '../../utils/AppError';

type Meta = { ip_address?: string | undefined; user_agent?: string | undefined };

export const ratingService = {
  async submitRating(params: {
    transactionId: string;
    reviewerId: string;
    rating: number;
    comment?: string;
    meta: Meta;
  }) {
    const { transactionId, reviewerId, rating, comment, meta } = params;

    const transaction = await EscrowTransactionModel.findById(transactionId);
    if (!transaction) throw new AppError('Transaction not found', 404);
    if (transaction.status !== 'completed') {
      throw new AppError('You can only rate completed transactions', 400);
    }

    // Determine who the reviewer is rating
    const isBuyer = transaction.user_id === reviewerId;
    const isSeller = transaction.receiver_id === reviewerId;
    if (!isBuyer && !isSeller) {
      throw new AppError('You are not a party to this transaction', 403);
    }

    const revieweeId = isBuyer ? transaction.receiver_id! : transaction.user_id;

    // Check if already rated
    const existing = await RatingModel.findByTransactionAndReviewer(transactionId, reviewerId);
    if (existing) throw new AppError('You have already rated this transaction', 409);

    const ratingRecord = await RatingModel.create({
      transaction_id: transactionId,
      reviewer_id: reviewerId,
      reviewee_id: revieweeId,
      rating,
      comment,
    });

    await AuditLogModel.log({
      user_id: reviewerId,
      action: 'rating_submitted',
      entity_type: 'rating',
      entity_id: ratingRecord.id,
      details: { transaction_id: transactionId, rating, reviewee_id: revieweeId },
      ...meta,
    });

    return ratingRecord;
  },

  async getTransactionRatings(transactionId: string) {
    return RatingModel.findByTransaction(transactionId);
  },

  async getUserSummary(userId: string) {
    return RatingModel.getUserSummary(userId);
  },

  async getUserRatings(userId: string, limit = 20, offset = 0) {
    const [ratings, summary] = await Promise.all([
      RatingModel.getUserRatings(userId, limit, offset),
      RatingModel.getUserSummary(userId),
    ]);
    return { ratings, ...summary };
  },
};
