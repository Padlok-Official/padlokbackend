import Paystack from "paystack-sdk";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const secretKey = process.env.PAYSTACK_SECRET_KEY!;
if (!secretKey) {
  console.error(
    "CRITICAL: PAYSTACK_SECRET_KEY is not defined in environment variables!",
  );
}
const paystack = new Paystack(secretKey);

class PaystackService {
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
  }): Promise<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }> {
    const result = await paystack.transaction.initialize({
      email: params.email,
      amount: String(params.amount),
      reference: params.reference,
      callback_url: params.callback_url,
      metadata: params.metadata,
    });

    if (!result.status) {
      throw new Error(
        (result as any).message || "Paystack initialization failed",
      );
    }
    return (result as any).data;
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
    const result = await paystack.transaction.verify(reference);

    if (!result.status) {
      throw new Error(
        (result as any).message || "Paystack verification failed",
      );
    }
    return (result as any).data;
  }

  /**
   * Resolve a bank account number to get the account name.
   */
  async resolveBankAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ account_name: string; account_number: string }> {
    const result = await paystack.verification.resolveAccount({
      account_number: accountNumber,
      bank_code: bankCode,
    });

    if (!result.status) {
      throw new Error((result as any).message || "Account resolution failed");
    }
    return (result as any).data;
  }

  /**
   * List supported banks.
   */
  async listBanks(): Promise<
    Array<{ name: string; code: string; type: string }>
  > {
    const result = await paystack.misc.banks();

    if (!result.status) {
      throw new Error((result as any).message || "Failed to fetch banks");
    }
    return (result as any).data;
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
    const result = await paystack.recipient.create({
      type: params.type,
      name: params.name,
      account_number: params.account_number,
      bank_code: params.bank_code,
      currency: params.currency,
    });

    if (!result.status) {
      throw new Error(
        (result as any).message || "Failed to create transfer recipient",
      );
    }
    return (result as any).data;
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
    const result = await paystack.transfer.initiate({
      source: params.source || "balance",
      amount: params.amount,
      recipient: params.recipient,
      reference: params.reference,
      reason: params.reason,
    });

    if (!result.status) {
      throw new Error((result as any).message || "Transfer initiation failed");
    }
    return (result as any).data;
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
    const result = await paystack.transaction.chargeAuthorization({
      authorization_code: params.authorization_code,
      email: params.email,
      amount: String(params.amount),
      reference: params.reference,
      metadata: params.metadata,
    });

    if (!result.status) {
      throw new Error((result as any).message || "Charge authorization failed");
    }
    return (result as any).data;
  }

  /**
   * Validate Paystack webhook signature using HMAC-SHA512.
   */
  static validateWebhookSignature(
    rawBody: string | Buffer,
    signature: string,
  ): boolean {
    if (!secretKey) return false;
    const hash = crypto
      .createHmac("sha512", secretKey)
      .update(rawBody)
      .digest("hex");
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }
}

export { PaystackService };
export const paystackService = new PaystackService();
