import logger from '../utils/logger';
import { Job, Worker } from "bullmq";
import db from "../config/database";
import { redisConnection } from "../config/redis";
import {
  AuditLogModel,
  PaymentMethodModel,
  TransactionModel,
  WalletModel,
  WalletTransactionModel,
} from "../models";
import { paystackService } from "../infrastructure/paystack/paystackService";
import socketService from "../infrastructure/socket/socketService";
import { inAppNotificationService } from "../features/notification/inAppNotificationService";
import { PaystackWebhookEvent, NotificationType } from "../types";
import { getCurrencySymbol } from "../utils/currencyUtils";

export const setupPaystackWorker = () => {
  const worker = new Worker(
    "paystack-webhook",
    async (job: Job<PaystackWebhookEvent>) => {
      const event = job.data;
      logger.info(
        `Processing Paystack event: ${event.event} [Job ID: ${job.id}]`,
      );

      switch (event.event) {
        case "charge.success":
          await handleChargeSuccess(event);
          break;
        case "transfer.success":
          await handleTransferSuccess(event);
          break;
        case "transfer.failed":
          await handleTransferFailed(event);
          break;
        default:
          logger.info(`Unhandled webhook event in worker: ${event.event}`);
      }
    },
    {
      connection: redisConnection as any, // Cast to any to avoid version mismatch in types
      concurrency: 5,
    },
  );

  worker.on("completed", (job) => {
    logger.info(`Job ${job.id} completed successfully`);
  });

  worker.on("failed", (job, err) => {
    logger.error(`Job ${job?.id} failed with error: ${err.message}`);
  });

  return worker;
};

async function getWalletOwner(walletId: string): Promise<{ user_id: string; currency: string } | null> {
  const { rows } = await db.query<{ user_id: string; currency: string }>(
    `SELECT user_id, currency FROM wallets WHERE id = $1`,
    [walletId],
  );
  return rows[0] ?? null;
}

async function handleChargeSuccess(event: PaystackWebhookEvent): Promise<void> {
  const { reference, amount, authorization, metadata } = event.data;

  // Verify the transaction with Paystack (Crucial for security)
  const verified = await paystackService.verifyTransaction(reference);
  if (verified.status !== "success") {
    throw new Error(
      `Transaction ${reference} verification failed: status is ${verified.status}`,
    );
  }

  // Handle legacy wallet_transactions
  const walletTx = await WalletTransactionModel.findByReference(reference);
  if (walletTx && walletTx.type === "funding") {
    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT status FROM wallet_transactions WHERE id = $1 FOR UPDATE`,
        [walletTx.id],
      );

      if (rows[0]?.status === "pending") {
        const amountInNaira = (amount / 100).toFixed(4);
        const balanceResult = await WalletModel.creditBalance(
          client,
          walletTx.wallet_id,
          amountInNaira,
        );
        await WalletTransactionModel.updateStatus(
          client,
          walletTx.id,
          "completed",
        );
        await client.query(
          `UPDATE wallet_transactions SET balance_after = $1 WHERE id = $2`,
          [balanceResult.balance_after, walletTx.id],
        );
        await client.query("COMMIT");

        if (authorization?.reusable && metadata?.wallet_id) {
          await saveCardAuthorization(
            metadata.wallet_id as string,
            authorization,
          );
        }

        // Notify user of wallet update
        const walletInfo = await getWalletOwner(walletTx.wallet_id);
        if (walletInfo) {
          const symbol = getCurrencySymbol(walletInfo.currency);
          socketService.emitToUser(walletInfo.user_id, "wallet:updated", {
            wallet_id: walletTx.wallet_id,
          });
          socketService.emitToUser(walletInfo.user_id, "transaction:updated", {
            type: "deposit",
          });
          await inAppNotificationService.notify({
            userId: walletInfo.user_id,
            type: NotificationType.DEPOSIT_COMPLETED,
            title: "Deposit Successful",
            body: `${symbol}${amountInNaira} has been added to your wallet.`,
            data: { screen: "/secured/(tabs)" },
          });
        }

        await AuditLogModel.log({
          action: "wallet_funded",
          entity_type: "wallet",
          entity_id: walletTx.wallet_id,
          details: { amount: amountInNaira, reference },
        });
      } else {
        await client.query("ROLLBACK");
      }
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  // Handle unified transactions table
  const transaction = await TransactionModel.findByReference(reference);
  if (transaction && transaction.type === "deposit") {
    const walletId = (transaction.metadata as any)?.wallet_id;
    if (!walletId)
      throw new Error(`No wallet_id in transaction metadata for ${reference}`);

    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT status FROM transactions WHERE id = $1 FOR UPDATE`,
        [transaction.id],
      );

      if (rows[0]?.status === "pending") {
        const amountInNaira = (amount / 100).toFixed(4);
        await WalletModel.creditBalance(client, walletId, amountInNaira);
        await TransactionModel.updateStatus(
          client,
          transaction.id,
          "completed",
        );
        await client.query("COMMIT");

        if (authorization?.reusable) {
          await saveCardAuthorization(walletId, authorization);
        }

        // Notify user of deposit completion
        socketService.emitToUser(transaction.user_id, "wallet:updated", {
          wallet_id: walletId,
        });
        socketService.emitToUser(transaction.user_id, "transaction:updated", {
          id: transaction.id,
          type: "deposit",
          status: "completed",
        });
        await inAppNotificationService.notify({
          userId: transaction.user_id,
          type: NotificationType.DEPOSIT_COMPLETED,
          title: "Deposit Successful",
          body: `${amountInNaira} has been added to your wallet.`,
          data: { screen: "/secured/transaction-details", params: { id: transaction.id } },
        });

        await AuditLogModel.log({
          action: "deposit_completed",
          entity_type: "transaction",
          entity_id: transaction.id,
          details: { amount: amountInNaira, reference },
        });
      } else {
        await client.query("ROLLBACK");
      }
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

async function handleTransferSuccess(
  event: PaystackWebhookEvent,
): Promise<void> {
  const { reference } = event.data;

  // Check legacy wallet_transactions
  const walletTx = await WalletTransactionModel.findByReference(reference);
  if (walletTx && walletTx.status === "pending") {
    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await WalletTransactionModel.updateStatus(
        client,
        walletTx.id,
        "completed",
      );
      await client.query("COMMIT");

      const walletInfo = await getWalletOwner(walletTx.wallet_id);
      if (walletInfo) {
        const symbol = getCurrencySymbol(walletInfo.currency);
        socketService.emitToUser(walletInfo.user_id, "wallet:updated", {
          wallet_id: walletTx.wallet_id,
        });
        socketService.emitToUser(walletInfo.user_id, "transaction:updated", {
          type: "withdrawal",
          status: "completed",
        });
        await inAppNotificationService.notify({
          userId: walletInfo.user_id,
          type: NotificationType.WITHDRAWAL_COMPLETED,
          title: "Withdrawal Successful",
          body: `${symbol}${walletTx.amount} has been sent to your bank account.`,
          data: { screen: "/secured/(tabs)" },
        });
      }

      await AuditLogModel.log({
        action: "withdrawal_completed",
        entity_type: "wallet",
        entity_id: walletTx.wallet_id,
        details: { amount: walletTx.amount, reference },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  // Check unified transactions table
  const transaction = await TransactionModel.findByReference(reference);
  if (
    transaction &&
    transaction.status === "pending" &&
    transaction.type === "withdrawal"
  ) {
    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await TransactionModel.updateStatus(client, transaction.id, "completed");
      await client.query("COMMIT");

      const txWalletId = (transaction.metadata as any)?.wallet_id;
      const txWalletInfo = txWalletId ? await getWalletOwner(txWalletId) : null;
      const txSymbol = getCurrencySymbol(txWalletInfo?.currency || 'GHS');
      socketService.emitToUser(transaction.user_id, "wallet:updated", {
        wallet_id: txWalletId,
      });
      socketService.emitToUser(transaction.user_id, "transaction:updated", {
        id: transaction.id,
        type: "withdrawal",
        status: "completed",
      });
      await inAppNotificationService.notify({
        userId: transaction.user_id,
        type: NotificationType.WITHDRAWAL_COMPLETED,
        title: "Withdrawal Successful",
        body: `${txSymbol}${transaction.amount} has been sent to your bank account.`,
        data: { screen: "/secured/transaction-details", params: { id: transaction.id } },
      });

      await AuditLogModel.log({
        action: "withdrawal_completed",
        entity_type: "transaction",
        entity_id: transaction.id,
        details: { amount: transaction.amount, reference },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

async function handleTransferFailed(
  event: PaystackWebhookEvent,
): Promise<void> {
  const { reference } = event.data;

  // Check legacy wallet_transactions
  const walletTx = await WalletTransactionModel.findByReference(reference);
  if (walletTx && walletTx.status === "pending") {
    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await WalletModel.creditBalance(
        client,
        walletTx.wallet_id,
        walletTx.amount,
      );
      await WalletTransactionModel.updateStatus(client, walletTx.id, "failed");
      await client.query("COMMIT");

      const walletInfo = await getWalletOwner(walletTx.wallet_id);
      if (walletInfo) {
        const symbol = getCurrencySymbol(walletInfo.currency);
        socketService.emitToUser(walletInfo.user_id, "wallet:updated", {
          wallet_id: walletTx.wallet_id,
        });
        socketService.emitToUser(walletInfo.user_id, "transaction:updated", {
          type: "withdrawal",
          status: "failed",
        });
        await inAppNotificationService.notify({
          userId: walletInfo.user_id,
          type: NotificationType.WITHDRAWAL_FAILED,
          title: "Withdrawal Failed",
          body: `Your withdrawal of ${symbol}${walletTx.amount} failed. The amount has been refunded to your wallet.`,
          data: { screen: "/secured/(tabs)" },
        });
      }

      await AuditLogModel.log({
        action: "withdrawal_failed_reversed",
        entity_type: "wallet",
        entity_id: walletTx.wallet_id,
        details: { amount: walletTx.amount, reference },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  // Check unified transactions table
  const transaction = await TransactionModel.findByReference(reference);
  if (
    transaction &&
    transaction.status === "pending" &&
    transaction.type === "withdrawal"
  ) {
    const walletId = (transaction.metadata as any)?.wallet_id;
    if (!walletId) return;

    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await WalletModel.creditBalance(client, walletId, transaction.amount);
      await TransactionModel.updateStatus(client, transaction.id, "failed");
      await client.query("COMMIT");

      const failedWalletInfo = await getWalletOwner(walletId);
      const failedSymbol = getCurrencySymbol(failedWalletInfo?.currency || 'GHS');
      socketService.emitToUser(transaction.user_id, "wallet:updated", {
        wallet_id: walletId,
      });
      socketService.emitToUser(transaction.user_id, "transaction:updated", {
        id: transaction.id,
        type: "withdrawal",
        status: "failed",
      });
      await inAppNotificationService.notify({
        userId: transaction.user_id,
        type: NotificationType.WITHDRAWAL_FAILED,
        title: "Withdrawal Failed",
        body: `Your withdrawal of ${failedSymbol}${transaction.amount} failed. The amount has been refunded to your wallet.`,
        data: { screen: "/secured/transaction-details", params: { id: transaction.id } },
      });

      await AuditLogModel.log({
        action: "withdrawal_failed_reversed",
        entity_type: "transaction",
        entity_id: transaction.id,
        details: { amount: transaction.amount, reference },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

async function saveCardAuthorization(
  walletId: string,
  authorization: NonNullable<PaystackWebhookEvent["data"]["authorization"]>,
): Promise<void> {
  try {
    const existing = await PaymentMethodModel.findByPaystackAuthCode(
      authorization.authorization_code,
      walletId,
    );
    if (existing) return;

    await PaymentMethodModel.create({
      wallet_id: walletId,
      type: "card",
      provider: authorization.bank,
      account_name: `${authorization.card_type} ****${authorization.last4}`,
      last_four: authorization.last4,
      paystack_auth_code: authorization.authorization_code,
      is_default: false,
      metadata: {
        card_type: authorization.card_type,
        exp_month: authorization.exp_month,
        exp_year: authorization.exp_year,
        bin: authorization.bin,
        bank: authorization.bank,
      },
    });

    await AuditLogModel.log({
      action: "card_saved_from_payment",
      entity_type: "payment_method",
      details: {
        wallet_id: walletId,
        last4: authorization.last4,
        bank: authorization.bank,
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to save card authorization");
  }
}
