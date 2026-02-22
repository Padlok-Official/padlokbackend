-- Add is_admin flag to users to restrict access to broadcast API
ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;

-- Optional: Create index for admin lookups
CREATE INDEX idx_users_is_admin ON users(is_admin) WHERE is_admin = TRUE;
