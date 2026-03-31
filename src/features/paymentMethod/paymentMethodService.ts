import { PaymentMethodModel, AuditLogModel } from '../../models';
import { paystackService } from '../../infrastructure/paystack/paystackService';
import { encrypt } from '../../utils/encryption';
import { AppError } from '../../utils/AppError';

type Meta = { ip_address?: string | undefined; user_agent?: string | undefined };

const MOMO_PROVIDER_CODES: Record<string, string> = {
  mtn: 'MTN',
  vodafone: 'VOD',
  airtel: 'ATL',
};

export const paymentMethodService = {
  async addBankAccount(params: { userId: string; walletId: string; bankCode: string; accountNumber: string; meta: Meta }) {
    const { userId, walletId, bankCode, accountNumber, meta } = params;

    let resolvedAccount: { account_name: string; account_number: string };
    try {
      resolvedAccount = await paystackService.resolveBankAccount(accountNumber, bankCode);
    } catch {
      throw new AppError('Could not resolve bank account. Please verify the account number and bank.', 400);
    }

    let recipientCode: string;
    try {
      const recipient = await paystackService.createTransferRecipient({
        type: 'nuban',
        name: resolvedAccount.account_name,
        account_number: resolvedAccount.account_number,
        bank_code: bankCode,
        currency: 'NGN',
      });
      recipientCode = recipient.recipient_code;
    } catch {
      throw new AppError('Failed to create transfer recipient. Please try again.', 500);
    }

    const encrypted = encrypt(accountNumber);
    const lastFour = accountNumber.slice(-4);

    const paymentMethod = await PaymentMethodModel.create({
      wallet_id: walletId,
      type: 'bank_account',
      provider: bankCode,
      account_name: resolvedAccount.account_name,
      encrypted_account_identifier: encrypted.ciphertext,
      identifier_iv: encrypted.iv,
      identifier_auth_tag: encrypted.authTag,
      last_four: lastFour,
      paystack_bank_code: bankCode,
      paystack_recipient_code: recipientCode,
      is_default: false,
    });

    await PaymentMethodModel.markVerified(paymentMethod.id);
    await AuditLogModel.log({ user_id: userId, action: 'payment_method_added', entity_type: 'payment_method', entity_id: paymentMethod.id, details: { type: 'bank_account', last_four: lastFour }, ...meta });

    return { id: paymentMethod.id, type: paymentMethod.type, account_name: resolvedAccount.account_name, last_four: lastFour, is_default: paymentMethod.is_default, is_verified: true };
  },

  async addMobileMoney(params: { userId: string; walletId: string; provider: string; phoneNumber: string; accountName: string; meta: Meta }) {
    const { userId, walletId, provider, phoneNumber, accountName, meta } = params;
    const paystackBankCode = MOMO_PROVIDER_CODES[provider] ?? provider;

    let recipientCode: string;
    try {
      const recipient = await paystackService.createTransferRecipient({
        type: 'mobile_money_ghana',
        name: accountName,
        account_number: phoneNumber,
        bank_code: paystackBankCode,
        currency: 'GHS',
      });
      recipientCode = recipient.recipient_code;
    } catch (err: any) {
      throw new AppError(err?.response?.data?.message || 'Failed to create mobile money recipient. Please try again.', 500);
    }

    const encrypted = encrypt(phoneNumber);
    const lastFour = phoneNumber.slice(-4);

    const paymentMethod = await PaymentMethodModel.create({
      wallet_id: walletId,
      type: 'mobile_money',
      provider,
      account_name: accountName,
      encrypted_account_identifier: encrypted.ciphertext,
      identifier_iv: encrypted.iv,
      identifier_auth_tag: encrypted.authTag,
      last_four: lastFour,
      paystack_recipient_code: recipientCode,
      is_default: false,
    });

    await PaymentMethodModel.markVerified(paymentMethod.id);
    await AuditLogModel.log({ user_id: userId, action: 'payment_method_added', entity_type: 'payment_method', entity_id: paymentMethod.id, details: { type: 'mobile_money', provider, last_four: lastFour }, ...meta });

    return { id: paymentMethod.id, type: paymentMethod.type, provider, account_name: accountName, last_four: lastFour, is_default: paymentMethod.is_default, is_verified: true };
  },

  async setDefault(walletId: string, paymentMethodId: string) {
    const paymentMethod = await PaymentMethodModel.findById(paymentMethodId);
    if (!paymentMethod || paymentMethod.wallet_id !== walletId) throw new AppError('Payment method not found', 404);
    await PaymentMethodModel.setDefault(walletId, paymentMethodId);
  },

  async deletePaymentMethod(userId: string, walletId: string, paymentMethodId: string, meta: Meta) {
    const deleted = await PaymentMethodModel.delete(paymentMethodId, walletId);
    if (!deleted) throw new AppError('Payment method not found', 404);
    await AuditLogModel.log({ user_id: userId, action: 'payment_method_deleted', entity_type: 'payment_method', entity_id: paymentMethodId, ...meta });
  },
};
