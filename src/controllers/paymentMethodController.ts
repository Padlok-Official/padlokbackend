import { Response, NextFunction } from "express";
import { PaymentMethodModel, AuditLogModel } from "../models";
import { paystackService } from "../services/paystackService";
import { encrypt } from "../utils/encryption";
import { AuthenticatedRequest, Wallet } from "../types";

type WalletRequest = AuthenticatedRequest & { wallet?: Wallet };

/**
 * POST /api/v1/payment-methods/bank
 * Add a bank account as a payment method.
 * Resolves account via Paystack, encrypts the account number, and creates a transfer recipient.
 */
export const addBankAccount = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const { bank_code, account_number } = req.body;
    const wallet = req.wallet!;

    // Resolve bank account via Paystack
    let resolvedAccount: { account_name: string; account_number: string };
    try {
      resolvedAccount = await paystackService.resolveBankAccount(
        account_number,
        bank_code,
      );
    } catch (err) {
      return res.status(400).json({
        success: false,
        message:
          "Could not resolve bank account. Please verify the account number and bank.",
      });
    }

    // Create Paystack transfer recipient
    let recipientCode: string;
    try {
      const recipient = await paystackService.createTransferRecipient({
        type: "nuban",
        name: resolvedAccount.account_name,
        account_number: resolvedAccount.account_number,
        bank_code,
        currency: "NGN",
      });
      recipientCode = recipient.recipient_code;
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Failed to create transfer recipient. Please try again.",
      });
    }

    // Encrypt account number
    const encrypted = encrypt(account_number);
    const lastFour = account_number.slice(-4);

    const paymentMethod = await PaymentMethodModel.create({
      wallet_id: wallet.id,
      type: "bank_account",
      provider: bank_code,
      account_name: resolvedAccount.account_name,
      encrypted_account_identifier: encrypted.ciphertext,
      identifier_iv: encrypted.iv,
      identifier_auth_tag: encrypted.authTag,
      last_four: lastFour,
      paystack_bank_code: bank_code,
      paystack_recipient_code: recipientCode,
      is_default: false,
    });

    await PaymentMethodModel.markVerified(paymentMethod.id);

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: "payment_method_added",
      entity_type: "payment_method",
      entity_id: paymentMethod.id,
      details: { type: "bank_account", last_four: lastFour },
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.status(201).json({
      success: true,
      message: "Bank account added successfully",
      data: {
        id: paymentMethod.id,
        type: paymentMethod.type,
        account_name: resolvedAccount.account_name,
        last_four: lastFour,
        is_default: paymentMethod.is_default,
        is_verified: true,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/payment-methods/mobile-money
 * Add a mobile money account as a payment method.
 */
export const addMobileMoney = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const { provider, phone_number, account_name } = req.body;

    const wallet = req.wallet!;

    // Paystack expects specific bank codes for Ghana mobile money providers
    const momoProviderCodes: Record<string, string> = {
      mtn: "MTN",
      vodafone: "VOD",
      airtel: "ATL",
    };
    const paystackBankCode = momoProviderCodes[provider] ?? provider;

    let recipientCode: string;
    try {
      const recipient = await paystackService.createTransferRecipient({
        type: "mobile_money_ghana",
        name: account_name,
        account_number: phone_number,
        bank_code: paystackBankCode,
        currency: "GHS",
      });
      recipientCode = recipient.recipient_code;
    } catch (err: any) {
      console.error("Paystack mobile money recipient error:", err?.response?.data || err?.message);
      return res.status(500).json({
        success: false,
        message: err?.response?.data?.message || "Failed to create mobile money recipient. Please try again.",
      });
    }

    // Encrypt phone number
    const encrypted = encrypt(phone_number);
    const lastFour = phone_number.slice(-4);

    const paymentMethod = await PaymentMethodModel.create({
      wallet_id: wallet.id,
      type: "mobile_money",
      provider,
      account_name,
      encrypted_account_identifier: encrypted.ciphertext,
      identifier_iv: encrypted.iv,
      identifier_auth_tag: encrypted.authTag,
      last_four: lastFour,
      paystack_recipient_code: recipientCode,
      is_default: false,
    });

    await PaymentMethodModel.markVerified(paymentMethod.id);

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: "payment_method_added",
      entity_type: "payment_method",
      entity_id: paymentMethod.id,
      details: { type: "mobile_money", provider, last_four: lastFour },
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.status(201).json({
      success: true,
      message: "Mobile money account added successfully",
      data: {
        id: paymentMethod.id,
        type: paymentMethod.type,
        provider,
        account_name,
        last_four: lastFour,
        is_default: paymentMethod.is_default,
        is_verified: true,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/payment-methods
 * List all payment methods for the user's wallet.
 */
export const getPaymentMethods = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const wallet = req.wallet!;
    const methods = await PaymentMethodModel.findByWalletId(wallet.id);

    return res.status(200).json({
      success: true,
      data: methods,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/payment-methods/:id/default
 * Set a payment method as default.
 */
export const setDefault = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const wallet = req.wallet!;
    const { id } = req.params;

    const paymentMethod = await PaymentMethodModel.findById(id);
    if (!paymentMethod || paymentMethod.wallet_id !== wallet.id) {
      return res.status(404).json({
        success: false,
        message: "Payment method not found",
      });
    }

    await PaymentMethodModel.setDefault(wallet.id, id);

    return res.status(200).json({
      success: true,
      message: "Default payment method updated",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/payment-methods/:id
 * Remove a payment method.
 */
export const deletePaymentMethod = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const wallet = req.wallet!;
    const { id } = req.params;

    const deleted = await PaymentMethodModel.delete(id, wallet.id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Payment method not found",
      });
    }

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: "payment_method_deleted",
      entity_type: "payment_method",
      entity_id: id,
      ip_address: req.ip,
      user_agent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "Payment method removed",
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/payment-methods/banks
 * List supported banks from Paystack.
 */
export const listBanks = async (
  _req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> => {
  try {
    const banks = await paystackService.listBanks();

    return res.status(200).json({
      success: true,
      data: banks,
    });
  } catch (err) {
    next(err);
  }
};
