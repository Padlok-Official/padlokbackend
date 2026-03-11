-- Migration: Update wallet_transactions foreign key to point to transactions table
-- Description: Redirects the escrow_transaction_id foreign key from the old escrow_transactions table to the unified transactions table.

-- 1. Data Migration: Copy existing records from escrow_transactions to transactions
INSERT INTO transactions (
  id, type, status, reference, amount, fee, currency, user_id, 
  receiver_id, item_description, item_photos, delivery_confirmed_at, 
  delivery_deadline, receiver_confirmed_at, metadata, created_at, updated_at
)
SELECT 
  id, 
  'escrow' as type, 
  status, 
  reference, 
  price as amount, 
  fee, 
  currency, 
  buyer_id as user_id, 
  seller_id as receiver_id, 
  item_description, 
  item_photos, 
  delivery_confirmed_at, 
  delivery_deadline, 
  buyer_confirmed_at as receiver_confirmed_at,
  COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'sender_wallet_id', buyer_wallet_id,
    'receiver_wallet_id', seller_wallet_id
  ) as metadata,
  created_at, 
  updated_at
FROM escrow_transactions
ON CONFLICT (reference) DO NOTHING;

-- 2. Update wallet_transactions foreign key
ALTER TABLE wallet_transactions 
DROP CONSTRAINT IF EXISTS wallet_transactions_escrow_transaction_id_fkey;

ALTER TABLE wallet_transactions
ADD CONSTRAINT wallet_transactions_escrow_transaction_id_fkey 
FOREIGN KEY (escrow_transaction_id) 
REFERENCES transactions(id) 
ON DELETE SET NULL;
