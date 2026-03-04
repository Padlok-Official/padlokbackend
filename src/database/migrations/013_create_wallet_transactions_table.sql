-- Create wallet transactions table for funding/withdrawal/escrow ledger
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES wallets(id),
  type VARCHAR(30) NOT NULL CHECK (type IN (
    'funding',
    'withdrawal',
    'escrow_lock',
    'escrow_release',
    'escrow_refund'
  )),
  amount DECIMAL(19, 4) NOT NULL CHECK (amount > 0),
  fee DECIMAL(19, 4) DEFAULT 0.0000,
  balance_before DECIMAL(19, 4) NOT NULL,
  balance_after DECIMAL(19, 4) NOT NULL,
  currency VARCHAR(3) DEFAULT 'NGN',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  reference VARCHAR(255) UNIQUE NOT NULL,
  paystack_reference VARCHAR(255),
  escrow_transaction_id UUID REFERENCES escrow_transactions(id),
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallet_tx_wallet_id ON wallet_transactions(wallet_id);
CREATE INDEX idx_wallet_tx_reference ON wallet_transactions(reference);
CREATE INDEX idx_wallet_tx_paystack_ref ON wallet_transactions(paystack_reference);
CREATE INDEX idx_wallet_tx_escrow_id ON wallet_transactions(escrow_transaction_id);
CREATE INDEX idx_wallet_tx_created_at ON wallet_transactions(created_at);
CREATE INDEX idx_wallet_tx_status ON wallet_transactions(status);

CREATE TRIGGER update_wallet_transactions_updated_at
  BEFORE UPDATE ON wallet_transactions
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();
