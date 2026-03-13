-- Migration to add buyer_confirmed_at to transactions table
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS buyer_confirmed_at TIMESTAMPTZ;
