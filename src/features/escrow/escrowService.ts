import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import {
  AuditLogModel,
  DisputeModel,
  EscrowTransactionModel,
  UserModel,
  WalletModel,
  WalletTransactionModel,
} from '../../models';
import cloudinaryService from '../../infrastructure/cloudinary/cloudinaryService';
import { NotificationService } from '../../infrastructure/notification/notificationService';
import socketService from '../../infrastructure/socket/socketService';
import { withTransaction } from '../../utils/withTransaction';
import { AppError } from '../../utils/AppError';
import { Wallet } from '../../types';
import { getCurrencySymbol } from '../../utils/currencyUtils';

type Meta = { ip_address?: string | undefined; user_agent?: string | undefined };

async function notifyUser(userId: string, title: string, body: string, screen: string, params?: Record<string, string>) {
  try {
    await NotificationService.sendToUser(userId, title, body, { screen, params });
  } catch (err) {
    logger.error({ err, userId }, "Failed to send push notification");
  }
}

const DELIVERY_HOURS_ALLOWED = [1, 2, 3, 6, 12, 24, 48, 72];
const PLATFORM_FEE_RATE = 0.03;

export const escrowService = {
  async initiateEscrow(params: {
    buyerId: string;
    buyerName: string;
    buyerWallet: Wallet;
    sellerEmail: string;
    itemTitle: string;
    itemDescription?: string;
    itemPhotos: string[];
    price: number;
    meta: Meta;
  }) {
    const { buyerId, buyerName, buyerWallet, sellerEmail, itemTitle, itemDescription, itemPhotos, price, meta } = params;

    const seller = await UserModel.findByEmail(sellerEmail);
    if (!seller) throw new AppError('Seller not found', 404);
    if (seller.id === buyerId) throw new AppError('You cannot initiate an escrow with yourself', 400);

    const sellerWallet = await WalletModel.findByUserId(seller.id);
    if (!sellerWallet) throw new AppError('Seller does not have a wallet', 400);

    const fee = Math.round(price * PLATFORM_FEE_RATE * 100) / 100;
    const totalRequired = price + fee;

    if (parseFloat(buyerWallet.balance) < totalRequired) {
      throw new AppError(
        `Insufficient wallet balance. You need ${getCurrencySymbol(buyerWallet.currency)}${totalRequired.toFixed(2)} but have ${getCurrencySymbol(buyerWallet.currency)}${parseFloat(buyerWallet.balance).toFixed(2)}.`,
        400,
      );
    }

    const reference = `padlok_escrow_${uuidv4()}`;
    const escrowTx = await withTransaction((client) =>
      EscrowTransactionModel.create(client, {
        reference,
        buyer_id: buyerId,
        seller_id: seller.id,
        buyer_wallet_id: buyerWallet.id,
        seller_wallet_id: sellerWallet.id,
        item_title: itemTitle,
        item_description: itemDescription,
        item_photos: itemPhotos,
        price: price.toString(),
        fee: fee.toString(),
        currency: buyerWallet.currency,
      }),
    );

    await AuditLogModel.log({
      user_id: buyerId,
      action: 'escrow_initiated',
      entity_type: 'escrow_transaction',
      entity_id: escrowTx.id,
      details: { price, fee, seller_id: seller.id, reference },
      ...meta,
    });

    socketService.emitToUser(seller.id, 'escrow:initiated', {
      id: escrowTx.id,
      reference: escrowTx.reference,
      buyer_name: buyerName,
      price,
      item_title: itemTitle,
      item_description: itemDescription,
    });
    socketService.emitToUser(seller.id, 'transaction:updated', { id: escrowTx.id });
    socketService.emitToUser(buyerId, 'transaction:updated', { id: escrowTx.id });

    const isSellerOnline = await socketService.isUserOnline(seller.id);
    if (!isSellerOnline) {
      await notifyUser(
        seller.id,
        'New Escrow Request',
        `${buyerName} wants to buy "${itemTitle}" for ${getCurrencySymbol(buyerWallet.currency)}${price}`,
        '/secured/transaction-details',
        { id: escrowTx.id },
      );
    }

    return { ...escrowTx, price, fee, seller_email: sellerEmail };
  },

  async setDeliveryAndFund(params: { userId: string; escrowId: string; deliveryHours: number; meta: Meta }) {
    const { userId, escrowId, deliveryHours, meta } = params;

    if (!DELIVERY_HOURS_ALLOWED.includes(deliveryHours)) {
      throw new AppError(`delivery_hours must be one of: ${DELIVERY_HOURS_ALLOWED.join(', ')}`, 400);
    }

    const result = await withTransaction(async (client) => {
      const escrowTx = await EscrowTransactionModel.findByIdForUpdate(client, escrowId);
      if (!escrowTx) throw new AppError('Escrow transaction not found', 404);
      if (escrowTx.receiver_id !== userId) throw new AppError('Only the seller can set the delivery window', 403);
      if (escrowTx.status !== 'initiated') throw new AppError(`Cannot set delivery. Current status: ${escrowTx.status}`, 400);

      const buyerWalletId = (escrowTx.metadata as any)?.sender_wallet_id;
      const sellerWalletId = (escrowTx.metadata as any)?.receiver_wallet_id;
      if (!buyerWalletId || !sellerWalletId) throw new AppError('Wallet information not found', 500);

      const price = parseFloat(escrowTx.amount);
      const fee = parseFloat(escrowTx.fee);
      const totalAmount = price + fee;

      const { rows: [buyerWallet] } = await client.query<Wallet>(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [buyerWalletId],
      );
      if (!buyerWallet || parseFloat(buyerWallet.balance) < totalAmount) {
        throw new AppError('Buyer has insufficient wallet balance to fund this escrow', 400);
      }

      const limitCheck = await WalletModel.checkSpendingLimits(buyerWalletId, totalAmount.toString());
      if (!limitCheck.allowed) throw new AppError(limitCheck.reason!, 400);

      await WalletModel.resetSpendingIfNeeded(client, buyerWalletId);
      const balanceResult = await WalletModel.debitBalance(client, buyerWalletId, totalAmount.toString());

      await WalletModel.creditEscrow(client, buyerWalletId, escrowTx.amount);
      await WalletModel.creditEscrow(client, sellerWalletId, escrowTx.amount);

      await WalletTransactionModel.create(client, {
        wallet_id: buyerWalletId,
        type: 'escrow_lock',
        amount: escrowTx.amount,
        fee: escrowTx.fee,
        balance_before: balanceResult.balance_before,
        balance_after: balanceResult.balance_after,
        status: 'completed',
        reference: `${escrowTx.reference}_lock`,
        escrow_transaction_id: escrowTx.id,
        description: `Escrow payment for: ${escrowTx.item_description.substring(0, 100)}`,
        currency: buyerWallet.currency,
      });

      const deliveryDeadline = new Date(Date.now() + deliveryHours * 60 * 60 * 1000);
      await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'funded', {
        delivery_deadline: deliveryDeadline,
        delivery_confirmed_at: new Date(),
        delivery_window: `${deliveryHours} hours`,
      });

      return { escrowTx, deliveryDeadline, price, fee, currency: buyerWallet.currency };
    });

    const deliveryWindowLabel =
      deliveryHours >= 24
        ? `${deliveryHours / 24} day${deliveryHours / 24 > 1 ? 's' : ''}`
        : `${deliveryHours} hour${deliveryHours > 1 ? 's' : ''}`;

    await AuditLogModel.log({
      user_id: userId,
      action: 'escrow_funded_delivery_set',
      entity_type: 'escrow_transaction',
      entity_id: escrowId,
      details: { delivery_hours: deliveryHours, delivery_deadline: result.deliveryDeadline.toISOString(), ...meta },
      ...meta,
    });

    const buyerId = result.escrowTx.user_id;
    socketService.emitToUser(buyerId, 'escrow:funded', {
      id: escrowId,
      delivery_deadline: result.deliveryDeadline,
      delivery_hours: deliveryHours,
      message: `Seller has set a ${deliveryWindowLabel} delivery window. Funds are now locked in escrow.`,
    });
    socketService.emitToUser(buyerId, 'wallet:updated', {});
    socketService.emitToUser(buyerId, 'transaction:updated', { id: escrowId });

    await notifyUser(
      buyerId,
      'Escrow Funded',
      `${getCurrencySymbol(result.currency)}${result.price} is now locked in escrow. Delivery window: ${deliveryWindowLabel}.`,
      '/secured/transaction-details',
      { id: escrowId },
    );

    return { delivery_deadline: result.deliveryDeadline, delivery_hours: deliveryHours, delivery_window: deliveryWindowLabel };
  },

  async confirmDelivery(params: { userId: string; escrowId: string; meta: Meta }) {
    const { userId, escrowId, meta } = params;

    const escrowTx = await withTransaction(async (client) => {
      const tx = await EscrowTransactionModel.findByIdForUpdate(client, escrowId);
      if (!tx) throw new AppError('Escrow transaction not found', 404);
      if (tx.receiver_id !== userId) throw new AppError('Only the seller can confirm delivery', 403);
      if (tx.status !== 'funded') throw new AppError(`Cannot confirm delivery. Current status: ${tx.status}`, 400);
      await EscrowTransactionModel.updateStatus(client, tx.id, 'delivery_confirmed');
      return tx;
    });

    await AuditLogModel.log({
      user_id: userId,
      action: 'delivery_confirmed',
      entity_type: 'escrow_transaction',
      entity_id: escrowId,
      details: { delivery_deadline: escrowTx.delivery_deadline },
      ...meta,
    });

    const buyerId = escrowTx.user_id;
    socketService.emitToUser(buyerId, 'escrow:delivery_confirmed', {
      id: escrowId,
      delivery_deadline: escrowTx.delivery_deadline,
      message: 'Seller has confirmed delivery. Please confirm receipt or raise a dispute.',
    });
    socketService.emitToUser(buyerId, 'transaction:updated', { id: escrowId });
    socketService.emitToUser(userId, 'transaction:updated', { id: escrowId });

    await notifyUser(
      buyerId,
      'Delivery Confirmed',
      'Seller has confirmed delivery. Please confirm receipt or raise a dispute.',
      '/secured/transaction-details',
      { id: escrowId },
    );

    return { delivery_deadline: escrowTx.delivery_deadline };
  },

  async confirmReceipt(params: { userId: string; escrowId: string; meta: Meta }) {
    const { userId, escrowId, meta } = params;

    const escrowTx = await withTransaction(async (client) => {
      const tx = await EscrowTransactionModel.findByIdForUpdate(client, escrowId);
      if (!tx) throw new AppError('Escrow transaction not found', 404);
      if (tx.user_id !== userId) throw new AppError('Only the buyer can confirm receipt', 403);
      if (tx.status !== 'delivery_confirmed') throw new AppError(`Cannot confirm receipt. Current status: ${tx.status}`, 400);

      const sellerWalletId = (tx.metadata as any)?.receiver_wallet_id;
      if (!sellerWalletId) throw new AppError('Seller wallet ID not found in metadata', 500);

      const sellerWallet = await WalletModel.findById(sellerWalletId);
      const balanceResult = await WalletModel.creditBalance(client, sellerWalletId, tx.amount);
      await EscrowTransactionModel.updateStatus(client, tx.id, 'completed', { buyer_confirmed_at: new Date() });

      await WalletTransactionModel.create(client, {
        wallet_id: sellerWalletId,
        type: 'escrow_release',
        amount: tx.amount,
        balance_before: balanceResult.balance_before,
        balance_after: balanceResult.balance_after,
        status: 'completed',
        reference: `${tx.reference}_release`,
        escrow_transaction_id: tx.id,
        description: `Escrow release: ${tx.item_description.substring(0, 100)}`,
        currency: sellerWallet?.currency,
      });

      const buyerWalletId = (tx.metadata as any)?.sender_wallet_id;
      if (buyerWalletId) await WalletModel.debitEscrow(client, buyerWalletId, tx.amount);
      await WalletModel.debitEscrow(client, sellerWalletId, tx.amount);

      return { ...tx, currency: sellerWallet?.currency || 'GHS' };
    });

    await AuditLogModel.log({
      user_id: userId,
      action: 'receipt_confirmed',
      entity_type: 'escrow_transaction',
      entity_id: escrowId,
      details: { price: escrowTx.amount, seller_id: escrowTx.receiver_id },
      ...meta,
    });

    const sellerId = escrowTx.receiver_id;
    const buyerId = escrowTx.user_id;

    for (const id of [sellerId, buyerId]) {
      socketService.emitToUser(id, 'escrow:completed', {
        id: escrowId,
        message: id === sellerId ? 'Funds released to your wallet' : 'Transaction completed successfully',
      });
      socketService.emitToUser(id, 'wallet:updated', {});
      socketService.emitToUser(id, 'transaction:updated', { id: escrowId });
    }

    const currSymbol = getCurrencySymbol(escrowTx.currency);
    await notifyUser(sellerId, 'Escrow Completed', `${currSymbol}${escrowTx.amount} has been released to your wallet.`, '/secured/transaction-details', { id: escrowId });
    await notifyUser(buyerId, 'Escrow Completed', 'Transaction completed successfully.', '/secured/transaction-details', { id: escrowId });
  },

  async raiseDispute(params: { userId: string; userName: string; escrowId: string; reason: string; evidencePhotos: string[]; meta: Meta }) {
    const { userId, userName, escrowId, reason, evidencePhotos, meta } = params;

    const escrowTx = await EscrowTransactionModel.findById(escrowId);
    if (!escrowTx) throw new AppError('Escrow transaction not found', 404);
    if (escrowTx.user_id !== userId) throw new AppError('Only the buyer can raise a dispute', 403);
    if (!['funded', 'delivery_confirmed'].includes(escrowTx.status)) {
      throw new AppError(`Cannot dispute. Current status: ${escrowTx.status}`, 400);
    }

    const existingDispute = await DisputeModel.findByEscrowId(escrowTx.id);
    if (existingDispute && ['open', 'under_review'].includes(existingDispute.status)) {
      throw new AppError('A dispute is already open for this transaction', 400);
    }

    const dispute = await withTransaction((client) =>
      Promise.all([
        DisputeModel.create(client, { escrow_transaction_id: escrowTx.id, raised_by: userId, reason, evidence_photos: evidencePhotos || [] }),
        EscrowTransactionModel.updateStatus(client, escrowTx.id, 'disputed'),
      ]).then(([d]) => d),
    );

    const otherUserId = userId === escrowTx.user_id ? escrowTx.receiver_id : escrowTx.user_id;
    socketService.emitToUser(otherUserId, 'escrow:disputed', { id: escrowId, reason, raised_by: userName });

    await notifyUser(otherUserId, 'Dispute Raised', `${userName} raised a dispute: "${reason}"`, '/secured/transaction-details', { id: escrowId });

    await AuditLogModel.log({
      user_id: userId,
      action: 'dispute_raised',
      entity_type: 'dispute',
      entity_id: dispute.id,
      details: { escrow_id: escrowId, reason },
      ...meta,
    });

    return { dispute_id: dispute.id, status: dispute.status };
  },

  async cancelEscrow(params: { userId: string; escrowId: string; meta: Meta }) {
    const { userId, escrowId } = params;

    const escrowTx = await EscrowTransactionModel.findById(escrowId);
    if (!escrowTx) throw new AppError('Escrow transaction not found', 404);
    if (escrowTx.user_id !== userId) throw new AppError('Only the buyer can cancel', 403);
    if (escrowTx.status !== 'initiated') {
      throw new AppError(`Cannot cancel. Current status: ${escrowTx.status}. Funds are already locked.`, 400);
    }

    await withTransaction((client) => EscrowTransactionModel.updateStatus(client, escrowTx.id, 'cancelled'));

    const sellerId = escrowTx.receiver_id;
    socketService.emitToUser(sellerId, 'escrow:cancelled', { id: escrowId, reference: escrowTx.reference, message: 'The buyer has cancelled the escrow transaction.' });
    socketService.emitToUser(sellerId, 'transaction:updated', { id: escrowId });
    socketService.emitToUser(userId, 'transaction:updated', { id: escrowId });

    await notifyUser(sellerId, 'Escrow Cancelled', 'The buyer has cancelled the escrow transaction.', '/secured/transaction-details', { id: escrowId });
  },

  async resolveDispute(params: {
    adminId: string;
    disputeId: string;
    resolution: 'refund' | 'release';
    adminNotes: string;
    meta: Meta;
  }) {
    const { adminId, disputeId, resolution, adminNotes, meta } = params;

    const dispute = await DisputeModel.findById(disputeId);
    if (!dispute) throw new AppError('Dispute not found', 404);
    if (!['open', 'under_review'].includes(dispute.status)) {
      throw new AppError(`Dispute already resolved with status: ${dispute.status}`, 400);
    }

    const escrowTx = await EscrowTransactionModel.findById(dispute.escrow_transaction_id);
    if (!escrowTx) throw new AppError('Associated escrow transaction not found', 500);

    await withTransaction(async (client) => {
      const buyerWalletId = (escrowTx.metadata as any)?.sender_wallet_id;
      const sellerWalletId = (escrowTx.metadata as any)?.receiver_wallet_id;

      if (resolution === 'refund') {
        if (!buyerWalletId) throw new AppError('Buyer wallet ID not found in metadata', 500);
        const buyerWallet = await WalletModel.findById(buyerWalletId);
        const balanceResult = await WalletModel.creditBalance(client, buyerWalletId, escrowTx.amount);
        await WalletTransactionModel.create(client, {
          wallet_id: buyerWalletId,
          type: 'escrow_refund',
          amount: escrowTx.amount,
          balance_before: balanceResult.balance_before,
          balance_after: balanceResult.balance_after,
          status: 'completed',
          reference: `${escrowTx.reference}_refund`,
          escrow_transaction_id: escrowTx.id,
          description: "Escrow refund — dispute resolved in buyer's favor",
          currency: buyerWallet?.currency,
        });
        await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'refunded');
        await DisputeModel.updateStatus(client, dispute.id, 'resolved_refund', adminId, adminNotes);
      } else {
        if (!sellerWalletId) throw new AppError('Seller wallet ID not found in metadata', 500);
        const sellerWallet = await WalletModel.findById(sellerWalletId);
        const balanceResult = await WalletModel.creditBalance(client, sellerWalletId, escrowTx.amount);
        await WalletTransactionModel.create(client, {
          wallet_id: sellerWalletId,
          type: 'escrow_release',
          amount: escrowTx.amount,
          balance_before: balanceResult.balance_before,
          balance_after: balanceResult.balance_after,
          status: 'completed',
          reference: `${escrowTx.reference}_release`,
          escrow_transaction_id: escrowTx.id,
          description: "Escrow release — dispute resolved in seller's favor",
          currency: sellerWallet?.currency,
        });
        await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'completed');
        await DisputeModel.updateStatus(client, dispute.id, 'resolved_release', adminId, adminNotes);
      }

      if (buyerWalletId) await WalletModel.debitEscrow(client, buyerWalletId, escrowTx.amount);
      if (sellerWalletId) await WalletModel.debitEscrow(client, sellerWalletId, escrowTx.amount);
    });

    const buyerId = escrowTx.user_id;
    const sellerId = escrowTx.receiver_id;

    for (const [id, msg] of [
      [buyerId, `Dispute resolved. Funds ${resolution === 'refund' ? 'refunded to you' : 'released to seller'}.`],
      [sellerId, `Dispute resolved. Funds ${resolution === 'refund' ? 'refunded to buyer' : 'released to you'}.`],
    ] as [string, string][]) {
      socketService.emitToUser(id, 'escrow:dispute_resolved', { id: escrowTx.id, resolution, message: msg });
      socketService.emitToUser(id, 'wallet:updated', {});
      socketService.emitToUser(id, 'transaction:updated', { id: escrowTx.id });
      await notifyUser(id, 'Dispute Resolved', msg, '/secured/transaction-details', { id: escrowTx.id });
    }

    await AuditLogModel.log({
      user_id: adminId,
      action: `dispute_resolved_${resolution}`,
      entity_type: 'dispute',
      entity_id: dispute.id,
      details: { escrow_id: escrowTx.id, resolution, admin_notes: adminNotes, amount: escrowTx.amount },
      ...meta,
    });

    return { resolution };
  },

  async getEscrowTransactions(userId: string, query: Record<string, unknown>) {
    const page = Math.max(1, parseInt(query.page as string) || 1);
    const limit = Math.min(100, parseInt(query.limit as string) || 20);
    return EscrowTransactionModel.findByUserId(userId, {
      role: query.role as 'buyer' | 'seller' | undefined,
      status: query.status as any,
      limit,
      offset: (page - 1) * limit,
    }).then((r) => ({ ...r, page, limit }));
  },

  async getEscrowById(userId: string, escrowId: string) {
    const escrowTx = await EscrowTransactionModel.findById(escrowId);
    if (!escrowTx) throw new AppError('Escrow transaction not found', 404);
    if (escrowTx.user_id !== userId && escrowTx.receiver_id !== userId) throw new AppError('Access denied', 403);
    const dispute = await DisputeModel.findByEscrowId(escrowTx.id);
    return { ...escrowTx, dispute: dispute || null };
  },

  async getDisputes(query: Record<string, unknown>) {
    const page = Math.max(1, parseInt(query.page as string) || 1);
    const limit = Math.min(100, parseInt(query.limit as string) || 20);
    return DisputeModel.findAll({ status: query.status as any, limit, offset: (page - 1) * limit })
      .then((r) => ({ ...r, page, limit }));
  },

  async uploadItemImages(images: string[]) {
    if (!images?.length) throw new AppError('No images provided', 400);
    if (images.length > 5) throw new AppError('Maximum 5 images allowed', 400);
    const results = await Promise.all(images.map((img) => cloudinaryService.uploadImage(img, 'escrow_items')));
    return results.map((r) => r.url);
  },
};
