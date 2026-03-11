-- Add profile fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS username VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS bio TEXT,
ADD COLUMN IF NOT EXISTS location VARCHAR(255),
ADD COLUMN IF NOT EXISTS profile_photo TEXT; -- Storing as URL or base64 depending on implementation

-- Index for username search
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
