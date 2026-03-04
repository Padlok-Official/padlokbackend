-- Add transaction PIN and spending limits to wallets
ALTER TABLE wallets
  ADD COLUMN pin_hash VARCHAR(255),
  ADD COLUMN pin_set_at TIMESTAMPTZ,
  ADD COLUMN pin_attempts INTEGER DEFAULT 0,
  ADD COLUMN pin_locked_until TIMESTAMPTZ,
  ADD COLUMN daily_limit DECIMAL(19, 4) DEFAULT 500000.0000,
  ADD COLUMN monthly_limit DECIMAL(19, 4) DEFAULT 5000000.0000,
  ADD COLUMN daily_spent DECIMAL(19, 4) DEFAULT 0.0000,
  ADD COLUMN monthly_spent DECIMAL(19, 4) DEFAULT 0.0000,
  ADD COLUMN daily_spent_reset_at DATE DEFAULT CURRENT_DATE,
  ADD COLUMN monthly_spent_reset_at DATE DEFAULT DATE_TRUNC('month', CURRENT_DATE);
