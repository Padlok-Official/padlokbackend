-- Ratings & feedback for completed escrow transactions.
-- Each party (buyer/seller) can rate the other once per transaction.
CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  reviewer_id UUID NOT NULL REFERENCES users(id),
  reviewee_id UUID NOT NULL REFERENCES users(id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One rating per reviewer per transaction
  CONSTRAINT uq_rating_per_reviewer UNIQUE (transaction_id, reviewer_id),
  -- Cannot rate yourself
  CONSTRAINT chk_no_self_rating CHECK (reviewer_id != reviewee_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_transaction ON ratings(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ratings_reviewee ON ratings(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_ratings_reviewer ON ratings(reviewer_id);
