import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import { requireWallet } from "../../middleware/walletOwnership";
import { requirePin } from "../../middleware/verifyPin";
import { requireIdempotencyKey } from "../../middleware/idempotency";
import { handleValidationErrors } from "../../middleware/validation";
import { walletTransactionLimiter, pinLimiter } from "../../middleware/security";
import * as walletController from "./walletController";
import * as validators from "./walletValidators";

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/v1/wallet - Get my wallet
router.get("/", requireWallet, walletController.getWallet);

// POST /api/v1/wallet/pin - Set transaction PIN
router.post(
  "/pin",
  pinLimiter,
  validators.setPinValidator,
  handleValidationErrors,
  walletController.setPin,
);

// PUT /api/v1/wallet/pin - Change transaction PIN
router.put(
  "/pin",
  pinLimiter,
  validators.changePinValidator,
  handleValidationErrors,
  walletController.changePin,
);

// POST /api/v1/wallet/fund - Initialize funding via Paystack
router.post(
  "/fund",
  requireWallet,
  requireIdempotencyKey,
  validators.fundWalletValidator,
  handleValidationErrors,
  walletController.fundWallet,
);

// GET /api/v1/wallet/fund/verify/:reference - Verify funding transaction
router.get(
  "/fund/verify/:reference",
  requireWallet,
  walletController.verifyFunding,
);

// POST /api/v1/wallet/withdraw - Withdraw to bank account
router.post(
  "/withdraw",
  walletTransactionLimiter,
  requireWallet,
  requirePin,
  requireIdempotencyKey,
  validators.withdrawValidator,
  handleValidationErrors,
  walletController.withdraw,
);

// GET /api/v1/wallet/transactions - Transaction history
router.get(
  "/transactions",
  requireWallet,
  validators.transactionHistoryValidator,
  handleValidationErrors,
  walletController.getTransactionHistory,
);

// GET /api/v1/wallet/transactions/:id - Single transaction detail
router.get(
  "/transactions/:id",
  requireWallet,
  walletController.getTransactionById,
);

// PUT /api/v1/wallet/limits - Update spending limits (requires PIN)
router.put(
  "/limits",
  requireWallet,
  requirePin,
  validators.updateLimitsValidator,
  handleValidationErrors,
  walletController.updateSpendingLimits,
);

export default router;
