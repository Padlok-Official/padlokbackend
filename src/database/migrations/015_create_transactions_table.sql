-- Unified transactions table for deposits, withdrawals, and escrow
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Transaction classification
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'escrow')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending',

  -- Common fields
  reference VARCHAR(100) NOT NULL UNIQUE,
  amount DECIMAL(19, 4) NOT NULL CHECK (amount > 0),
  fee DECIMAL(19, 4) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'NGN',
  user_id UUID NOT NULL REFERENCES users(id),

  -- Paystack fields (deposit & withdrawal)
  paystack_reference VARCHAR(200),
  payment_method_id UUID REFERENCES payment_methods(id),

  -- Escrow-specific fields
  receiver_id UUID REFERENCES users(id),
  item_photos TEXT[],
  item_description TEXT,
  delivery_window INTERVAL,
  delivery_deadline TIMESTAMPTZ,
  delivery_confirmed_at TIMESTAMPTZ,
  receiver_confirmed_at TIMESTAMPTZ,

  -- Extensibility
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Escrow: sender and receiver must differ
  CONSTRAINT chk_escrow_parties CHECK (
    type != 'escrow' OR (receiver_id IS NOT NULL AND user_id != receiver_id)
  ),

  -- Escrow must have item description
  CONSTRAINT chk_escrow_description CHECK (
    type != 'escrow' OR item_description IS NOT NULL
  ),

  -- Status values per type
  CONSTRAINT chk_status_by_type CHECK (
    (type = 'deposit'    AND status IN ('pending', 'completed', 'failed')) OR
    (type = 'withdrawal' AND status IN ('pending', 'processing', 'completed', 'failed')) OR
    (type = 'escrow'     AND status IN ('initiated', 'funded', 'delivery_confirmed', 'completed', 'disputed', 'refunded', 'cancelled'))
  )
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_receiver_id ON transactions(receiver_id) WHERE receiver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions(reference);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON transactions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_transactions_paystack_ref ON transactions(paystack_reference) WHERE paystack_reference IS NOT NULL;

-- Composite index for user transaction listing (covers most list queries)
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_id, created_at DESC);

-- Auto-update updated_at trigger
CREATE OR REPLACE TRIGGER set_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
