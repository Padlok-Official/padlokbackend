-- Add encrypted fields and Paystack references to payment methods
ALTER TABLE payment_methods
  ADD COLUMN encrypted_account_identifier TEXT,
  ADD COLUMN identifier_iv VARCHAR(32),
  ADD COLUMN identifier_auth_tag VARCHAR(32),
  ADD COLUMN last_four VARCHAR(4),
  ADD COLUMN paystack_auth_code VARCHAR(255),
  ADD COLUMN paystack_bank_code VARCHAR(20),
  ADD COLUMN paystack_recipient_code VARCHAR(255);
