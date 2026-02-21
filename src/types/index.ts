import { Request } from 'express';

export interface User {
  id: string;
  name: string;
  email: string;
  phone_number: string;
  email_verified: boolean;
  phone_verified: boolean;
  is_active: boolean;
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
