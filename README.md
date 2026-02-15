# Padlok Backend

A robust, secure escrow backend built with **Express**, **TypeScript**, **PostgreSQL**, and industry-standard security practices.

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express
- **Language**: TypeScript
- **Database**: PostgreSQL
- **Security**: Helmet, CORS, rate limiting, bcrypt, JWT
- **Validation**: express-validator
- **Logging**: Morgan

## Project Structure

```
src/
├── config/         # Database, env config
├── controllers/    # Auth, User controllers
├── database/       # Migrations
├── middleware/     # Auth, validation, security, error handling
├── routes/         # API routes
├── types/          # TypeScript interfaces
├── validators/     # Request validation schemas
├── app.ts          # Express app setup
└── server.ts       # Entry point
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required:

- `DATABASE_URL` – PostgreSQL connection string
- `JWT_SECRET` – Strong secret (min 32 chars)

### 3. Database migrations

```bash
npm run migrate
```

### 4. Run

**Development** (with nodemon):

```bash
npm run dev
```

**Production**:

```bash
npm run build
npm start
```

## API Endpoints

### Auth

| Method | Endpoint         | Description          |
|--------|------------------|----------------------|
| POST   | `/api/auth/register` | Register user      |
| POST   | `/api/auth/login`    | Login             |
| POST   | `/api/auth/refresh`  | Refresh tokens    |
| POST   | `/api/auth/logout`   | Logout (authenticated) |

### Users

| Method | Endpoint                | Description        |
|--------|-------------------------|--------------------|
| GET    | `/api/users/me`         | Get profile + wallet |
| PATCH  | `/api/users/me`         | Update profile     |
| POST   | `/api/users/change-password` | Change password |

## Security Features

- **Helmet**: Security headers
- **Rate limiting**: General (100/15min) and auth (10/15min)
- **Password**: bcrypt, 12 rounds, strong policy (upper, lower, number)
- **JWT**: Access + refresh tokens, hashed refresh storage
- **Validation**: express-validator on all inputs
- **SQL**: Parameterized queries to prevent injection
- **CORS**: Configurable origins

## Schema

### Users

- `id`, `name`, `email`, `password_hash`, `phone_number`
- `email_verified`, `phone_verified`, `is_active`
- `last_login_at`, `created_at`, `updated_at`

### Wallets

- `id`, `user_id`, `balance`, `currency`, `status`
- `created_at`, `updated_at`

### Payment methods

- `id`, `wallet_id`, `type`, `provider`, `account_identifier`, `account_name`
- `is_default`, `is_verified`, `metadata`
