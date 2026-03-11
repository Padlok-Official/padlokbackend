import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/database';
import {
  WalletModel,
  EscrowTransactionModel,
  WalletTransactionModel,
  DisputeModel,
  AuditLogModel,
} from '../models';
import { UserModel } from '../models';
import cloudinaryService from '../services/cloudinaryService';

import { AuthenticatedRequest, Wallet } from '../types';

type WalletRequest = AuthenticatedRequest & { wallet?: Wallet };

/**
 * POST /api/v1/escrow/initiate
 * Buyer initiates an escrow transaction. Funds are locked from buyer's wallet.
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

    // Check spending limits
    const limitCheck = await WalletModel.checkSpendingLimits(buyerWallet.id, price);
    if (!limitCheck.allowed) {
      return res.status(400).json({ success: false, message: limitCheck.reason });
    }

    const pool = db.getPool()!;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Reset spending if needed
      await WalletModel.resetSpendingIfNeeded(client, buyerWallet.id);

      // Debit buyer's wallet (lock funds in escrow)
      const balanceResult = await WalletModel.debitBalance(client, buyerWallet.id, price);

      // Create escrow transaction
      const escrowTx = await EscrowTransactionModel.create(client, {
        reference,
        buyer_id: req.user!.id,
        seller_id: seller.id,
        buyer_wallet_id: buyerWallet.id,
        seller_wallet_id: sellerWallet.id,
        item_description,
        item_photos,
        price,
      });

      // Update escrow status to funded
      await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'funded');

      // Record wallet transaction (escrow lock)
      await WalletTransactionModel.create(client, {
        wallet_id: buyerWallet.id,
        type: 'escrow_lock',
        amount: price,
        balance_before: balanceResult.balance_before,
        balance_after: balanceResult.balance_after,
        status: 'completed',
        reference: `${reference}_lock`,
        escrow_transaction_id: escrowTx.id,
        description: `Escrow payment for: ${item_description.substring(0, 100)}`,
      });

      await client.query('COMMIT');

      await AuditLogModel.log({
        user_id: req.user!.id,
        action: 'escrow_initiated',
        entity_type: 'escrow_transaction',
        entity_id: escrowTx.id,
        details: { price, seller_id: seller.id, reference },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      return res.status(201).json({
        success: true,
        message: 'Escrow transaction initiated. Funds locked.',
        data: {
          id: escrowTx.id,
          reference: escrowTx.reference,
          status: 'funded',
          price,
          seller_email,
          item_description,
          item_photos,
          created_at: escrowTx.created_at,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof Error && err.message === 'Insufficient wallet balance') {
        return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
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
 * Seller confirms they have delivered the item. Starts the confirmation countdown.
 */
export const confirmDelivery = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> => {
  try {
    const escrowTx = await EscrowTransactionModel.findById(req.params.id);

    if (!escrowTx) {
      return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
    }

    if (escrowTx.receiver_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Only the seller can confirm delivery' });
    }

    if (escrowTx.status !== 'funded') {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm delivery. Current status: ${escrowTx.status}`,
      });
    }

    // Set delivery deadline (1 hour from now)
    const deliveryDeadline = new Date(Date.now() + 60 * 60 * 1000);

    const pool = db.getPool()!;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await EscrowTransactionModel.updateStatus(client, escrowTx.id, 'delivery_confirmed', {
        delivery_confirmed_at: new Date(),
        delivery_deadline: deliveryDeadline,
      });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: 'delivery_confirmed',
      entity_type: 'escrow_transaction',
      entity_id: escrowTx.id,
      details: { delivery_deadline: deliveryDeadline.toISOString() },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Delivery confirmed. Buyer has until the deadline to confirm receipt or raise a dispute.',
      data: {
        delivery_deadline: deliveryDeadline,
      },
    });
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
    const escrowTx = await EscrowTransactionModel.findById(req.params.id);

    if (!escrowTx) {
      return res.status(404).json({ success: false, message: 'Escrow transaction not found' });
    }

    if (escrowTx.user_id !== req.user!.id) {
      return res.status(403).json({ success: false, message: 'Only the buyer can confirm receipt' });
    }

    if (escrowTx.status !== 'delivery_confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot confirm receipt. Current status: ${escrowTx.status}`,
      });
    }

    const pool = db.getPool()!;
    const client = await pool.connect();
    const releaseReference = `${escrowTx.reference}_release`;

    try {
      await client.query('BEGIN');

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

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await AuditLogModel.log({
      user_id: req.user!.id,
      action: 'receipt_confirmed',
      entity_type: 'escrow_transaction',
      entity_id: escrowTx.id,
      details: { price: escrowTx.amount, seller_id: escrowTx.receiver_id },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Receipt confirmed. Funds released to seller.',
    });
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

      await client.query('COMMIT');

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
