-- Add escrow_balance to wallets table
ALTER TABLE wallets ADD COLUMN escrow_balance DECIMAL(19, 4) DEFAULT 0.0000 CHECK (escrow_balance >= 0);
