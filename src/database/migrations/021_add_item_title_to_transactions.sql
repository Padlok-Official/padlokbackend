-- Add item_title field for escrow transactions
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS item_title VARCHAR(255);

-- Make item_description optional (drop the NOT NULL constraint)
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS chk_escrow_description;
