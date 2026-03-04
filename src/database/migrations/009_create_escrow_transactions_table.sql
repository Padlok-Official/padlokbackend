-- Create escrow transactions table
CREATE TABLE IF NOT EXISTS escrow_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference VARCHAR(255) UNIQUE NOT NULL,
  buyer_id UUID NOT NULL REFERENCES users(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  buyer_wallet_id UUID NOT NULL REFERENCES wallets(id),
  seller_wallet_id UUID NOT NULL REFERENCES wallets(id),

  -- Item details
  item_description TEXT NOT NULL,
  item_photos TEXT[] NOT NULL DEFAULT '{}',
  price DECIMAL(19, 4) NOT NULL CHECK (price > 0),
  fee DECIMAL(19, 4) DEFAULT 0.0000,
  currency VARCHAR(3) DEFAULT 'NGN',

  -- Escrow state machine
  status VARCHAR(30) NOT NULL DEFAULT 'initiated' CHECK (status IN (
    'initiated',
    'funded',
    'delivery_confirmed',
    'completed',
    'disputed',
    'refunded',
    'cancelled'
  )),

  -- Payment tracking
  paystack_reference VARCHAR(255),
  paystack_transfer_code VARCHAR(255),

  -- Delivery & confirmation
  delivery_confirmed_at TIMESTAMPTZ,
  delivery_deadline TIMESTAMPTZ,
  buyer_confirmed_at TIMESTAMPTZ,

  -- Metadata
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Check buyer and seller are different users
ALTER TABLE escrow_transactions ADD CONSTRAINT check_different_parties
  CHECK (buyer_id != seller_id);

CREATE INDEX idx_escrow_tx_buyer_id ON escrow_transactions(buyer_id);
CREATE INDEX idx_escrow_tx_seller_id ON escrow_transactions(seller_id);
CREATE INDEX idx_escrow_tx_reference ON escrow_transactions(reference);
CREATE INDEX idx_escrow_tx_status ON escrow_transactions(status);
CREATE INDEX idx_escrow_tx_created_at ON escrow_transactions(created_at);
CREATE INDEX idx_escrow_tx_delivery_deadline ON escrow_transactions(delivery_deadline);

CREATE TRIGGER update_escrow_transactions_updated_at
  BEFORE UPDATE ON escrow_transactions
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();
