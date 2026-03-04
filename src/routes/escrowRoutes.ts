import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { isAdmin } from '../middleware/auth';
import { requireWallet } from '../middleware/walletOwnership';
import { requirePin } from '../middleware/verifyPin';
import { requireIdempotencyKey } from '../middleware/idempotency';
import { handleValidationErrors } from '../middleware/validation';
import { walletTransactionLimiter } from '../middleware/security';
import * as escrowController from '../controllers/escrowController';
import * as validators from '../validators/escrowValidators';

const router = Router();

// All routes require authentication
router.use(authenticate);

// POST /api/v1/escrow/initiate - Buyer initiates escrow
router.post(
  '/initiate',
  walletTransactionLimiter,
  requireWallet,
  requirePin,
  requireIdempotencyKey,
  validators.initiateEscrowValidator,
  handleValidationErrors,
  escrowController.initiateEscrow
);

// GET /api/v1/escrow - List user's escrow transactions
router.get(
  '/',
  validators.escrowListValidator,
  handleValidationErrors,
  escrowController.getEscrowTransactions
);

// GET /api/v1/escrow/:id - Get escrow transaction detail
router.get('/:id', escrowController.getEscrowById);

// POST /api/v1/escrow/:id/confirm-delivery - Seller confirms delivery
router.post(
  '/:id/confirm-delivery',
  validators.confirmDeliveryValidator,
  handleValidationErrors,
  escrowController.confirmDelivery
);

// POST /api/v1/escrow/:id/confirm-receipt - Buyer confirms receipt (releases funds)
router.post(
  '/:id/confirm-receipt',
  requirePin,
  validators.confirmReceiptValidator,
  handleValidationErrors,
  escrowController.confirmReceipt
);

// POST /api/v1/escrow/:id/dispute - Buyer raises a dispute
router.post(
  '/:id/dispute',
  validators.raiseDisputeValidator,
  handleValidationErrors,
  escrowController.raiseDispute
);

// POST /api/v1/escrow/:id/cancel - Buyer cancels escrow (only if initiated, not funded)
router.post('/:id/cancel', escrowController.cancelEscrow);

// Admin-only dispute resolution routes
// GET /api/v1/escrow/disputes/all - List all disputes (admin)
router.get(
  '/disputes/all',
  isAdmin,
  escrowController.getDisputes
);

// POST /api/v1/escrow/disputes/:id/resolve - Admin resolves dispute
router.post(
  '/disputes/:id/resolve',
  isAdmin,
  validators.resolveDisputeValidator,
  handleValidationErrors,
  escrowController.resolveDispute
);

export default router;
