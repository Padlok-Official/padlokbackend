import { NextFunction, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database';
import {
  AuditLogModel,
  DisputeModel,
  EscrowTransactionModel,
  UserModel,
  WalletModel,
  WalletTransactionModel,
} from '../models';
import cloudinaryService from '../services/cloudinaryService';
import socketService from '../services/socketService';

import { AuthenticatedRequest, Wallet } from '../types';

type WalletRequest = AuthenticatedRequest & { wallet?: Wallet };

/**
 * POST /api/v1/escrow/initiate
 * Buyer initiates an escrow transaction. NO funds are deducted yet.
 * The transaction is created with status 'initiated'. Funds are locked
 * only when the seller sets the delivery window and activates the escrow.
 */
export const initiateEscrow = async (
  req: WalletRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { seller_email, item_description, item_photos, price } = req.body;
    const buyerWallet = req.wallet!;
    const reference = `padlok_escrow_${uuidv4()}`;

    // Find seller
    const seller = await UserModel.findByEmail(seller_email);
    if (!seller) {
      return res.status(404).json({
        success: false,
        message: 'Seller not found',
      });
    }

    if (seller.id === req.user!.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot initiate an escrow with yourself',
      });
    }

    const sellerWallet = await WalletModel.findByUserId(seller.id);
    if (!sellerWallet) {
      return res.status(400).json({
        success: false,
        message: 'Seller does not have a wallet',
      });
    }

    const platformFeeRate = 0.03;
    const fee = Math.round(price * platformFeeRate * 100) / 100;

    const pool = db.getPool()!;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create escrow transaction with status 'initiated' — no funds deducted yet
      const escrowTx = await EscrowTransactionModel.create(client, {
        reference,
        buyer_id: req.user!.id,
        seller_id: seller.id,
        buyer_wallet_id: buyerWallet.id,
        seller_wallet_id: sellerWallet.id,
        item_description,
        item_photos,
        price: price.toString(),
        fee: fee.toString(),
      });

      await client.query('COMMIT');

      await AuditLogModel.log({
        user_id: req.user!.id,
        action: 'escrow_initiated',
        entity_type: 'escrow_transaction',
        entity_id: escrowTx.id,
        details: { price, fee, seller_id: seller.id, reference },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      // Emit socket event to seller
      socketService.emitToUser(seller.id, 'escrow:initiated', {
        id: escrowTx.id,
        reference: escrowTx.reference,
        buyer_name: req.user!.name,
        price,
        item_description,
      });

      return res.status(201).json({
        success: true,
        message: 'Escrow transaction initiated. Awaiting seller to set delivery window.',
        data: {
          id: escrowTx.id,
          reference: escrowTx.reference,
          status: 'initiated',
          price,
          fee,
          seller_email,
          item_description,
          item_photos,
          created_at: escrowTx.created_at,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/escrow/:id/set-delivery
 * Seller sets the delivery window (in hours) and activates the escrow.
 * This is when funds are deducted from the buyer's wallet and locked in escrow.
 * The delivery countdown starts immediately.
 */
export const setDeliveryAndFund = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { delivery_hours } = req.body;

    if (!delivery_hours || ![1, 2, 3, 6, 12, 24, 48, 72].includes(delivery_hours)) {
      return res.status(400).json({
        success: false,
        message: 'delivery_hours must be one of: 1, 2, 3, 6, 12, 24, 48, 72',
      });
    }

    const pool = db.getPool()!;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const escrowTx = await EscrowTransactionModel.findByIdForUpdate(client, req.params.id);

      if (!escrowTx) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
      }

      if (escrowTx.receiver_id !== req.user!.id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: 'Only the seller can set the delivery window' });
      }

      if (escrowTx.status !== 'initiated') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Cannot set delivery. Current status: ${escrowTx.status}`,
        });
      }

      // Get buyer and seller wallets from metadata
      const buyerWalletId = (escrowTx.metadata as any)?.sender_wallet_id;
      const sellerWalletId = (escrowTx.metadata as any)?.receiver_wallet_id;

      if (!buyerWalletId || !sellerWalletId) {
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, message: 'Wallet information not found' });
      }

      const price = parseFloat(escrowTx.amount);
      const fee = parseFloat(escrowTx.fee);
      const totalAmount = price + fee;

      // Check buyer has sufficient balance (using client for transactional read)
      const { rows: [buyerWallet] } = await client.query<Wallet>(
        'SELECT * FROM wallets WHERE id = $1 FOR UPDATE',
        [buyerWalletId]
      );
      if (!buyerWallet || parseFloat(buyerWallet.balance) < totalAmount) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Buyer has insufficient wallet balance to fund this escrow',
        });
      }

      // Check spending limits
      const limitCheck = await WalletModel.checkSpendingLimits(buyerWalletId, totalAmount.toString());
      if (!limitCheck.allowed) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: limitCheck.reason });
      }

      // Reset spending if needed
      await WalletModel.resetSpendingIfNeeded(client, buyerWalletId);

      // Debit buyer's wallet
      const balanceResult = await WalletModel.debitBalance(client, buyerWalletId, totalAmount.toString());

      // Credit escrow balances for both parties (principal only)
      await WalletModel.creditEscrow(client, buyerWalletId, escrowTx.amount);
      await WalletModel.creditEscrow(client, sellerWalletId, escrowTx.amount);

      // Record wallet transaction
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
      });

      // Calculate delivery deadline
      const deliveryDeadline = new Date(Date.now() + delivery_hours * 60 * 60 * 1000);
      const deliveryWindowLabel = delivery_hours >= 24
        ? `${delivery_hours / 24} day${delivery_hours / 24 > 1 ? 's' : ''}`
        : `${delivery_hours} hour${delivery_hours > 1 ? 's' : ''}`;

      // Update status to funded with delivery info
      await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'funded', {
        delivery_deadline: deliveryDeadline,
        delivery_confirmed_at: new Date(),
        delivery_window: `${delivery_hours} hours`,
      });

      await client.query('COMMIT');

      await AuditLogModel.log({
        user_id: req.user!.id,
        action: 'escrow_funded_delivery_set',
        entity_type: 'escrow_transaction',
        entity_id: escrowTx.id,
        details: {
          delivery_hours,
          delivery_deadline: deliveryDeadline.toISOString(),
          price,
          fee,
          totalAmount,
        },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      // Emit socket event to buyer
      socketService.emitToUser(escrowTx.user_id, 'escrow:funded', {
        id: escrowTx.id,
        delivery_deadline: deliveryDeadline,
        delivery_hours,
        message: `Seller has set a ${deliveryWindowLabel} delivery window. Funds are now locked in escrow.`,
      });

      return res.status(200).json({
        success: true,
        message: `Delivery window set to ${deliveryWindowLabel}. Funds locked in escrow. Countdown started.`,
        data: {
          delivery_deadline: deliveryDeadline,
          delivery_hours,
          delivery_window: deliveryWindowLabel,
          status: 'funded',
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof Error && err.message === 'Insufficient wallet balance') {
        return res.status(400).json({ success: false, message: 'Buyer has insufficient wallet balance' });
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/escrow/:id/confirm-delivery
 * Seller confirms they have delivered the item.
 * Status transitions from 'funded' to 'delivery_confirmed'.
 */
export const confirmDelivery = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const escrowTx = await EscrowTransactionModel.findByIdForUpdate(client, req.params.id);

      if (!escrowTx) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
      }

      if (escrowTx.receiver_id !== req.user!.id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: 'Only the seller can confirm delivery' });
      }

      if (escrowTx.status !== 'funded') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Cannot confirm delivery. Current status: ${escrowTx.status}`,
        });
      }

      await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'delivery_confirmed');

      await AuditLogModel.log({
        user_id: req.user!.id,
        action: 'delivery_confirmed',
        entity_type: 'escrow_transaction',
        entity_id: escrowTx.id,
        details: { delivery_deadline: escrowTx.delivery_deadline },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      await client.query('COMMIT');

      // Emit socket event to buyer
      socketService.emitToUser(escrowTx.user_id, 'escrow:delivery_confirmed', {
        id: escrowTx.id,
        delivery_deadline: escrowTx.delivery_deadline,
        message: 'Seller has confirmed delivery. Please confirm receipt or raise a dispute.',
      });

      return res.status(200).json({
        success: true,
        message: 'Delivery confirmed. Buyer can now confirm receipt or raise a dispute.',
        data: {
          delivery_deadline: escrowTx.delivery_deadline,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/escrow/:id/confirm-receipt
 * Buyer confirms receipt. Funds are released to the seller.
 */
export const confirmReceipt = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const pool = db.getPool()!;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const escrowTx = await EscrowTransactionModel.findByIdForUpdate(client, req.params.id);

      if (!escrowTx) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
      }

      if (escrowTx.user_id !== req.user!.id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ success: false, message: 'Only the buyer can confirm receipt' });
      }

      if (escrowTx.status !== 'delivery_confirmed') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Cannot confirm receipt. Current status: ${escrowTx.status}`,
        });
      }

      const releaseReference = `${escrowTx.reference}_release`;

      // Credit seller's wallet
      const sellerWalletId = (escrowTx.metadata as any)?.receiver_wallet_id;
      if (!sellerWalletId) {
        throw new Error('Seller wallet ID not found in metadata');
      }

      const balanceResult = await WalletModel.creditBalance(
        client,
        sellerWalletId,
        escrowTx.amount
      );

      // Update escrow status
      await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'completed', {
        buyer_confirmed_at: new Date(),
      });

      // Record wallet transaction (escrow release to seller)
      await WalletTransactionModel.create(client, {
        wallet_id: sellerWalletId,
        type: 'escrow_release',
        amount: escrowTx.amount,
        balance_before: balanceResult.balance_before,
        balance_after: balanceResult.balance_after,
        status: 'completed',
        reference: releaseReference,
        escrow_transaction_id: escrowTx.id,
        description: `Escrow release: ${escrowTx.item_description.substring(0, 100)}`,
      });

      // Update escrow balances (reduce for both - principal only)
      const buyerWalletId = (escrowTx.metadata as any)?.sender_wallet_id;
      if (buyerWalletId) {
        await WalletModel.debitEscrow(client, buyerWalletId, escrowTx.amount);
      }
      await WalletModel.debitEscrow(client, sellerWalletId, escrowTx.amount);

      await AuditLogModel.log({
        user_id: req.user!.id,
        action: 'receipt_confirmed',
        entity_type: 'escrow_transaction',
        entity_id: escrowTx.id,
        details: { price: escrowTx.amount, seller_id: escrowTx.receiver_id },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      await client.query('COMMIT');

      // Emit socket events to both parties
      socketService.emitToUser(escrowTx.receiver_id, 'escrow:completed', {
        id: escrowTx.id,
        message: 'Funds released to your wallet',
      });
      socketService.emitToUser(escrowTx.user_id, 'escrow:completed', {
        id: escrowTx.id,
        message: 'Transaction completed successfully',
      });

      return res.status(200).json({
        success: true,
        message: 'Receipt confirmed. Funds released to seller.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/escrow/:id/dispute
 * Buyer raises a dispute on an escrow transaction.
 */
export const raiseDispute = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { reason, evidence_photos } = req.body;
    const escrowTx = await EscrowTransactionModel.findById(req.params.id);

    if (!escrowTx) {
      return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
    }

    if (escrowTx.user_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Only the buyer can raise a dispute' });
    }

    const disputeAllowedStatuses = ['funded', 'delivery_confirmed'];
    if (!disputeAllowedStatuses.includes(escrowTx.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot dispute. Current status: ${escrowTx.status}`,
      });
    }

    // Check if dispute already exists
    const existingDispute = await DisputeModel.findByEscrowId(escrowTx.id);
    if (existingDispute && ['open', 'under_review'].includes(existingDispute.status)) {
      return res.status(400).json({
        success: false,
        message: 'A dispute is already open for this transaction',
      });
    }

    const pool = db.getPool()!;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const dispute = await DisputeModel.create(client, {
        escrow_transaction_id: escrowTx.id,
        raised_by: req.user!.id,
        reason,
        evidence_photos: evidence_photos || [],
      });

      await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'disputed');

      await client.query('COMMIT');

      // Notify the other party about the dispute
      const otherUserId = req.user!.id === escrowTx.user_id ? escrowTx.receiver_id : escrowTx.user_id;
      socketService.emitToUser(otherUserId, 'escrow:disputed', {
        id: escrowTx.id,
        reason,
        raised_by: req.user!.name,
      });

      await AuditLogModel.log({
        user_id: req.user!.id,
        action: 'dispute_raised',
        entity_type: 'dispute',
        entity_id: dispute.id,
        details: { escrow_id: escrowTx.id, reason },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      return res.status(201).json({
        success: true,
        message: 'Dispute raised successfully. An admin will review your case.',
        data: {
          dispute_id: dispute.id,
          status: dispute.status,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/escrow/:id/cancel
 * Buyer cancels an escrow transaction (only if not yet funded or still in initiated state).
 */
export const cancelEscrow = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const escrowTx = await EscrowTransactionModel.findById(req.params.id);

    if (!escrowTx) {
      return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
    }

    if (escrowTx.user_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Only the buyer can cancel' });
    }

    if (escrowTx.status !== 'initiated') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel. Current status: ${escrowTx.status}. Funds are already locked.`,
      });
    }

    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'cancelled');
      await client.query('COMMIT');

      // Notify seller that the escrow was cancelled
      socketService.emitToUser(escrowTx.receiver_id, 'escrow:cancelled', {
        id: escrowTx.id,
        reference: escrowTx.reference,
        message: 'The buyer has cancelled the escrow transaction.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return res.status(200).json({
      success: true,
      message: 'Escrow transaction cancelled',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/escrow
 * Get list of escrow transactions for the authenticated user.
 */
export const getEscrowTransactions = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const result = await EscrowTransactionModel.findByUserId(req.user!.id, {
      role: req.query.role as 'buyer' | 'seller' | undefined,
      status: req.query.status as any,
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      data: {
        transactions: result.transactions,
        pagination: {
          page,
          limit,
          total: result.total,
          total_pages: Math.ceil(result.total / limit),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/escrow/:id
 * Get single escrow transaction detail.
 */
export const getEscrowById = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const escrowTx = await EscrowTransactionModel.findById(req.params.id);

    if (!escrowTx) {
      return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
    }

    // Only buyer or seller can view
    if (escrowTx.user_id !== req.user!.id && escrowTx.receiver_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Get associated dispute if any
    const dispute = await DisputeModel.findByEscrowId(escrowTx.id);

    return res.status(200).json({
      success: true,
      data: {
        ...escrowTx,
        dispute: dispute || null,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/escrow/disputes/:id/resolve (Admin only)
 * Admin resolves a dispute — either refund to buyer or release to seller.
 */
export const resolveDispute = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { resolution, admin_notes } = req.body;
    const dispute = await DisputeModel.findById(req.params.id);

    if (!dispute) {
      return res.status(404).json({ success: false, message: 'Dispute not found' });
    }

    if (!['open', 'under_review'].includes(dispute.status)) {
      return res.status(400).json({
        success: false,
        message: `Dispute already resolved with status: ${dispute.status}`,
      });
    }

    const escrowTx = await EscrowTransactionModel.findById(dispute.escrow_transaction_id);
    if (!escrowTx) {
      return res.status(500).json({ success: false, message: 'Associated escrow transaction not found' });
    }

    const pool = db.getPool()!;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      if (resolution === 'refund') {
        // Refund buyer
        const buyerWalletId = (escrowTx.metadata as any)?.sender_wallet_id;
        if (!buyerWalletId) {
          throw new Error('Buyer wallet ID not found in metadata');
        }

        const balanceResult = await WalletModel.creditBalance(
          client,
          buyerWalletId,
          escrowTx.amount
        );

        await WalletTransactionModel.create(client, {
          wallet_id: buyerWalletId,
          type: 'escrow_refund',
          amount: escrowTx.amount,
          balance_before: balanceResult.balance_before,
          balance_after: balanceResult.balance_after,
          status: 'completed',
          reference: `${escrowTx.reference}_refund`,
          escrow_transaction_id: escrowTx.id,
          description: 'Escrow refund — dispute resolved in buyer\'s favor',
        });

        await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'refunded');
        await DisputeModel.updateStatus(client, dispute.id, 'resolved_refund', req.user!.id, admin_notes);
      } else {
        // Release to seller
        const sellerWalletId = (escrowTx.metadata as any)?.receiver_wallet_id;
        if (!sellerWalletId) {
          throw new Error('Seller wallet ID not found in metadata');
        }

        const balanceResult = await WalletModel.creditBalance(
          client,
          sellerWalletId,
          escrowTx.amount
        );

        await WalletTransactionModel.create(client, {
          wallet_id: sellerWalletId,
          type: 'escrow_release',
          amount: escrowTx.amount,
          balance_before: balanceResult.balance_before,
          balance_after: balanceResult.balance_after,
          status: 'completed',
          reference: `${escrowTx.reference}_release`,
          escrow_transaction_id: escrowTx.id,
          description: 'Escrow release — dispute resolved in seller\'s favor',
        });

        await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'completed');
        await DisputeModel.updateStatus(client, dispute.id, 'resolved_release', req.user!.id, admin_notes);
      }

      // Update escrow balances (reduce for both regardless of resolution - principal only)
      const buyerWalletId = (escrowTx.metadata as any)?.sender_wallet_id;
      const sellerWalletId = (escrowTx.metadata as any)?.receiver_wallet_id;

      if (buyerWalletId) {
        await WalletModel.debitEscrow(client, buyerWalletId, escrowTx.amount);
      }
      if (sellerWalletId) {
        await WalletModel.debitEscrow(client, sellerWalletId, escrowTx.amount);
      }

      await client.query('COMMIT');

      // Notify both parties about the resolution
      socketService.emitToUser(escrowTx.user_id, 'escrow:dispute_resolved', {
        id: escrowTx.id,
        resolution,
        message: `Dispute resolved. Funds ${resolution === 'refund' ? 'refunded to you' : 'released to seller'}.`,
      });
      socketService.emitToUser(escrowTx.receiver_id, 'escrow:dispute_resolved', {
        id: escrowTx.id,
        resolution,
        message: `Dispute resolved. Funds ${resolution === 'refund' ? 'refunded to buyer' : 'released to you'}.`,
      });

      await AuditLogModel.log({
        user_id: req.user!.id,
        action: `dispute_resolved_${resolution}`,
        entity_type: 'dispute',
        entity_id: dispute.id,
        details: {
          escrow_id: escrowTx.id,
          resolution,
          admin_notes,
          amount: escrowTx.amount,
        },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      return res.status(200).json({
        success: true,
        message: `Dispute resolved. Funds ${resolution === 'refund' ? 'refunded to buyer' : 'released to seller'}.`,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/escrow/disputes (Admin only)
 * List all disputes for admin review.
 */
export const getDisputes = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const result = await DisputeModel.findAll({
      status: req.query.status as any,
      limit,
      offset,
    });

    return res.status(200).json({
      success: true,
      data: {
        disputes: result.disputes,
        pagination: {
          page,
          limit,
          total: result.total,
          total_pages: Math.ceil(result.total / limit),
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/escrow/upload-images
 * Upload item images to Cloudinary. Returns the secure URLs.
 */
export const uploadItemImages = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const { images } = req.body; // Array of base64 strings

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No images provided',
      });
    }

    if (images.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 5 images allowed',
      });
    }

    const uploadPromises = images.map((image) =>
      cloudinaryService.uploadImage(image, 'escrow_items')
    );

    const results = await Promise.all(uploadPromises);
    const imageUrls = results.map((r) => r.url);

    return res.status(200).json({
      success: true,
      message: 'Images uploaded successfully',
      data: {
        urls: imageUrls,
      },
    });
  } catch (err) {
    next(err);
  }
};
