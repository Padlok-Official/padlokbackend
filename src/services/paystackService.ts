import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';

class PaystackService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.paystack.co',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Initialize a transaction for wallet funding or escrow payment.
   * Amount is in kobo (NGN * 100).
   */
  async initializeTransaction(params: {
    email: string;
    amount: number;
    reference: string;
    callback_url?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ authorization_url: string; access_code: string; reference: string }> {
    const { data } = await this.client.post('/transaction/initialize', params);
    if (!data.status) throw new Error(data.message || 'Paystack initialization failed');
    return data.data;
  }

  /**
   * Verify a transaction by reference.
   */
  async verifyTransaction(reference: string): Promise<{
    status: string;
    amount: number;
    currency: string;
    reference: string;
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
    customer: { email: string };
    metadata?: Record<string, unknown>;
  }> {
    const { data } = await this.client.get(`/transaction/verify/${encodeURIComponent(reference)}`);
    if (!data.status) throw new Error(data.message || 'Paystack verification failed');
    return data.data;
  }

  /**
   * Resolve a bank account number to get the account name.
   */
  async resolveBankAccount(
    accountNumber: string,
    bankCode: string
  ): Promise<{ account_name: string; account_number: string }> {
    const { data } = await this.client.get('/bank/resolve', {
      params: { account_number: accountNumber, bank_code: bankCode },
    });
    if (!data.status) throw new Error(data.message || 'Account resolution failed');
    return data.data;
  }

  /**
   * List supported banks.
   */
  async listBanks(): Promise<Array<{ name: string; code: string; type: string }>> {
    const { data } = await this.client.get('/bank', {
      params: { country: 'nigeria', perPage: 100 },
    });
    if (!data.status) throw new Error(data.message || 'Failed to fetch banks');
    return data.data;
  }

  /**
   * Create a transfer recipient for withdrawals to bank.
   */
  async createTransferRecipient(params: {
    type: string;
    name: string;
    account_number: string;
    bank_code: string;
    currency: string;
  }): Promise<{ recipient_code: string }> {
    const { data } = await this.client.post('/transferrecipient', params);
    if (!data.status) throw new Error(data.message || 'Failed to create transfer recipient');
    return data.data;
  }

  /**
   * Initiate a transfer (withdrawal to bank account).
   * Amount is in kobo.
   */
  async initiateTransfer(params: {
    amount: number;
    recipient: string;
    reference: string;
    reason?: string;
    source?: string;
  }): Promise<{ transfer_code: string; status: string }> {
    const { data } = await this.client.post('/transfer', {
      source: params.source || 'balance',
      ...params,
    });
    if (!data.status) throw new Error(data.message || 'Transfer initiation failed');
    return data.data;
  }

  /**
   * Charge a card using a saved authorization code.
   * Amount is in kobo.
   */
  async chargeAuthorization(params: {
    authorization_code: string;
    email: string;
    amount: number;
    reference: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ status: string; reference: string }> {
    const { data } = await this.client.post('/transaction/charge_authorization', params);
    if (!data.status) throw new Error(data.message || 'Charge authorization failed');
    return data.data;
  }

  /**
   * Validate Paystack webhook signature using HMAC-SHA512.
   */
  static validateWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return false;
    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }
}

export { PaystackService };
export const paystackService = new PaystackService();
