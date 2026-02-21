-- Add fcm_token column to users table for push notifications
ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT;

-- Index for faster lookups by token if needed
CREATE INDEX IF NOT EXISTS idx_users_fcm_token ON users(fcm_token);
