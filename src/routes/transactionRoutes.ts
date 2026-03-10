import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireWallet } from '../middleware/walletOwnership';
import { requirePin } from '../middleware/verifyPin';
import { requireIdempotencyKey } from '../middleware/idempotency';
import { handleValidationErrors } from '../middleware/validation';
import { walletTransactionLimiter } from '../middleware/security';
import * as transactionController from '../controllers/transactionController';
import * as validators from '../validators/transactionValidators';

const router = Router();

// All routes require authentication
router.use(authenticate);

// POST /api/v1/transactions/deposit - Initiate a deposit via Paystack
router.post(
  '/deposit',
  requireWallet,
  requireIdempotencyKey,
  validators.depositValidator,
  handleValidationErrors,
  transactionController.initiateDeposit
);

// POST /api/v1/transactions/withdraw - Initiate a withdrawal via Paystack
router.post(
  '/withdraw',
  walletTransactionLimiter,
  requireWallet,
  requirePin,
  requireIdempotencyKey,
  validators.withdrawalValidator,
  handleValidationErrors,
  transactionController.initiateWithdrawal
);

// POST /api/v1/transactions/escrow - Initiate an escrow transaction
router.post(
  '/escrow',
  walletTransactionLimiter,
  requireWallet,
  requirePin,
  requireIdempotencyKey,
  validators.escrowValidator,
  handleValidationErrors,
  transactionController.initiateEscrow
);

// GET /api/v1/transactions - List all transactions
router.get(
  '/',
  validators.transactionListValidator,
  handleValidationErrors,
  transactionController.getTransactions
);

// GET /api/v1/transactions/:id - Get transaction detail
router.get(
  '/:id',
  validators.transactionByIdValidator,
  handleValidationErrors,
  transactionController.getTransactionById
);

// POST /api/v1/transactions/:id/confirm-delivery - Receiver confirms delivery (escrow)
router.post(
  '/:id/confirm-delivery',
  validators.confirmDeliveryValidator,
  handleValidationErrors,
  transactionController.confirmDelivery
);

// POST /api/v1/transactions/:id/confirm-receipt - Sender confirms receipt, releases funds (escrow)
router.post(
  '/:id/confirm-receipt',
  requirePin,
  validators.confirmReceiptValidator,
  handleValidationErrors,
  transactionController.confirmReceipt
);

// POST /api/v1/transactions/:id/cancel - Cancel an escrow transaction
router.post(
  '/:id/cancel',
  validators.transactionByIdValidator,
  handleValidationErrors,
  transactionController.cancelTransaction
);

export default router;
