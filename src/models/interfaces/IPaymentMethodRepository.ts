import { PaymentMethod } from '../../types';

export interface IPaymentMethodRepository {
  create(data: {
    wallet_id: string;
    type: PaymentMethod['type'];
    provider?: string;
    account_name?: string;
    account_identifier?: string;
    encrypted_account_identifier?: string;
    identifier_iv?: string;
    identifier_auth_tag?: string;
    last_four?: string;
    paystack_auth_code?: string;
    paystack_bank_code?: string;
    paystack_recipient_code?: string;
    is_default?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentMethod>;
  findByWalletId(walletId: string): Promise<PaymentMethod[]>;
  findById(id: string): Promise<PaymentMethod | null>;
  findDefaultByWalletId(walletId: string): Promise<PaymentMethod | null>;
  setDefault(walletId: string, paymentMethodId: string): Promise<void>;
  delete(id: string, walletId: string): Promise<boolean>;
  markVerified(id: string): Promise<void>;
  findByPaystackAuthCode(authCode: string, walletId: string): Promise<PaymentMethod | null>;
}
