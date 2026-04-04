-- Compound index for wallet ownership checks (used in requireWallet middleware on every request)
CREATE INDEX IF NOT EXISTS idx_wallets_user_status ON wallets(user_id, status);

-- Transaction lookups by receiver (used in OR conditions: user_id = $1 OR receiver_id = $1)
CREATE INDEX IF NOT EXISTS idx_transactions_receiver_created ON transactions(receiver_id, created_at DESC);

-- Transaction reference lookups (used by webhook processing)
CREATE INDEX IF NOT EXISTS idx_transactions_paystack_ref ON transactions(paystack_reference) WHERE paystack_reference IS NOT NULL;

-- Wallet transaction lookups by reference (used by webhook processing)
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_reference ON wallet_transactions(reference);
