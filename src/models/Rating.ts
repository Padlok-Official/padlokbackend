import db from '../config/database';

export interface Rating {
  id: string;
  transaction_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
}

export interface UserRatingSummary {
  average_rating: number;
  total_ratings: number;
}

export const RatingModel = {
  async create(data: {
    transaction_id: string;
    reviewer_id: string;
    reviewee_id: string;
    rating: number;
    comment?: string;
  }): Promise<Rating> {
    const { rows } = await db.query<Rating>(
      `INSERT INTO ratings (transaction_id, reviewer_id, reviewee_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.transaction_id, data.reviewer_id, data.reviewee_id, data.rating, data.comment || null],
    );
    return rows[0];
  },

  async findByTransactionAndReviewer(transactionId: string, reviewerId: string): Promise<Rating | null> {
    const { rows } = await db.query<Rating>(
      `SELECT * FROM ratings WHERE transaction_id = $1 AND reviewer_id = $2`,
      [transactionId, reviewerId],
    );
    return rows[0] ?? null;
  },

  async findByTransaction(transactionId: string): Promise<Rating[]> {
    const { rows } = await db.query<Rating>(
      `SELECT * FROM ratings WHERE transaction_id = $1 ORDER BY created_at`,
      [transactionId],
    );
    return rows;
  },

  async getUserSummary(userId: string): Promise<UserRatingSummary> {
    const { rows } = await db.query<{ average_rating: string; total_ratings: string }>(
      `SELECT
         COALESCE(AVG(rating), 0) AS average_rating,
         COUNT(*)::int AS total_ratings
       FROM ratings
       WHERE reviewee_id = $1`,
      [userId],
    );
    return {
      average_rating: parseFloat(parseFloat(rows[0].average_rating).toFixed(1)),
      total_ratings: parseInt(rows[0].total_ratings, 10),
    };
  },

  async getUserRatings(userId: string, limit = 20, offset = 0): Promise<Rating[]> {
    const { rows } = await db.query<Rating>(
      `SELECT r.*, u.name AS reviewer_name, u.profile_photo AS reviewer_photo
       FROM ratings r
       JOIN users u ON u.id = r.reviewer_id
       WHERE r.reviewee_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return rows;
  },
};
