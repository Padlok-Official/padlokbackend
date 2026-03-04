import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireWallet } from '../middleware/walletOwnership';
import { handleValidationErrors } from '../middleware/validation';
import * as paymentMethodController from '../controllers/paymentMethodController';
import * as validators from '../validators/paymentMethodValidators';

const router = Router();

// All routes require authentication and wallet ownership
router.use(authenticate, requireWallet);

// GET /api/v1/payment-methods - List my payment methods
router.get('/', paymentMethodController.getPaymentMethods);

// GET /api/v1/payment-methods/banks - List supported banks
router.get('/banks', paymentMethodController.listBanks);

// POST /api/v1/payment-methods/bank - Add bank account
router.post(
  '/bank',
  validators.addBankAccountValidator,
  handleValidationErrors,
  paymentMethodController.addBankAccount
);

// POST /api/v1/payment-methods/mobile-money - Add mobile money account
router.post(
  '/mobile-money',
  validators.addMobileMoneyValidator,
  handleValidationErrors,
  paymentMethodController.addMobileMoney
);

// PUT /api/v1/payment-methods/:id/default - Set as default
router.put(
  '/:id/default',
  validators.setDefaultValidator,
  handleValidationErrors,
  paymentMethodController.setDefault
);

// DELETE /api/v1/payment-methods/:id - Remove payment method
router.delete(
  '/:id',
  validators.deletePaymentMethodValidator,
  handleValidationErrors,
  paymentMethodController.deletePaymentMethod
);

export default router;
