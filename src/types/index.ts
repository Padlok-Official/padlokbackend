import { Request } from 'express';

export interface User {
  id: string;
  name: string;
  email: string;
  phone_number: string;
  email_verified: boolean;
  phone_verified: boolean;
  is_active: boolean;
  username?: string;
  bio?: string;
  location?: string;
  profile_photo?: string;
  fcm_token?: string;
  created_at: Date;
}

export interface UserWithPassword extends User {
  password_hash: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  balance: string;
  escrow_balance: string;
  currency: string;
  status: 'active' | 'frozen' | 'suspended';
  created_at: Date;
  updated_at: Date;
}

export interface PaymentMethod {
  id: string;
  wallet_id: string;
  type: 'bank_account' | 'card' | 'mobile_money' | 'other';
  provider?: string;
  account_identifier?: string;
  account_name?: string;
  is_default: boolean;
  is_verified: boolean;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface AuthPayload {
  userId: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  errors?: Array<{ field: string; message: string }>;
}

// Extended wallet with PIN and spending limit fields
export interface WalletWithPin extends Wallet {
  pin_hash?: string;
  pin_set_at?: Date;
  pin_attempts: number;
  pin_locked_until?: Date;
  daily_limit: string;
  monthly_limit: string;
  escrow_balance: string;
  daily_spent: string;
  monthly_spent: string;
  daily_spent_reset_at: string;
  monthly_spent_reset_at: string;
}

// Escrow transaction between buyer and seller (Specific view of Transaction)
export interface EscrowTransaction {
  id: string;
  reference: string;
  user_id: string; // buyer
  receiver_id: string; // seller
  amount: string; // price
  fee: string;
  currency: string;
  status: EscrowStatus;
  paystack_reference?: string;
  paystack_transfer_code?: string;
  delivery_confirmed_at?: Date;
  delivery_deadline?: Date;
  receiver_confirmed_at?: Date; // formerly buyer_confirmed_at in EscrowTransaction, but Transaction uses receiver_confirmed_at
  item_description: string;
  item_photos: string[];
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// Wallet ledger entry (funding, withdrawal, escrow lock/release)
export interface WalletTransaction {
  id: string;
  wallet_id: string;
  type: 'funding' | 'withdrawal' | 'escrow_lock' | 'escrow_release' | 'escrow_refund';
  amount: string;
  fee: string;
  balance_before: string;
  balance_after: string;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'reversed';
  reference: string;
  paystack_reference?: string;
  escrow_transaction_id?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// Dispute raised on an escrow transaction
export interface Dispute {
  id: string;
  escrow_transaction_id: string;
  raised_by: string;
  reason: string;
  evidence_photos: string[];
  status: 'open' | 'under_review' | 'resolved_refund' | 'resolved_release' | 'closed';
  admin_id?: string;
  admin_notes?: string;
  resolved_at?: Date;
  created_at: Date;
  updated_at: Date;
}

// Rating / feedback for completed transactions
export interface Rating {
  id: string;
  transaction_id: string;
  reviewer_id: string;
  reviewee_id: string;
  rating: number;
  comment: string | null;
  created_at: Date;
}

// Idempotency key for preventing double-processing
export interface IdempotencyKey {
  id: string;
  key: string;
  user_id: string;
  request_path: string;
  request_body_hash: string;
  response_status?: number;
  response_body?: Record<string, unknown>;
  created_at: Date;
  expires_at: Date;
}

// Audit log entry
export interface AuditLogEntry {
  id: string;
  user_id?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

// Unified transaction (deposit, withdrawal, escrow)
export type TransactionType = 'deposit' | 'withdrawal' | 'escrow';

export type DepositStatus = 'pending' | 'completed' | 'failed';
export type WithdrawalStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type EscrowStatus = 'initiated' | 'funded' | 'delivery_confirmed' | 'completed' | 'disputed' | 'refunded' | 'cancelled';

export type TransactionStatus = DepositStatus | WithdrawalStatus | EscrowStatus;

export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  reference: string;
  amount: string;
  fee: string;
  currency: string;
  user_id: string;
  paystack_reference?: string;
  payment_method_id?: string;
  receiver_id?: string;
  item_title?: string;
  item_photos?: string[];
  item_description?: string;
  delivery_window?: string; // PostgreSQL interval as string
  delivery_deadline?: Date;
  delivery_confirmed_at?: Date;
  receiver_confirmed_at?: Date;
  sender_name?: string;
  sender_photo?: string;
  receiver_name?: string;
  receiver_photo?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// Paystack webhook event payload
export interface PaystackWebhookEvent {
  event: string;
  data: {
    reference: string;
    amount: number;
    currency: string;
    status: string;
    channel: string;
    authorization?: {
      authorization_code: string;
      card_type: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      bin: string;
      bank: string;
      reusable: boolean;
    };
    customer: {
      email: string;
    };
    metadata?: Record<string, unknown>;
  };
}

// Request with wallet attached by middleware
export interface WalletRequest extends AuthenticatedRequest {
  wallet?: Wallet;
}
