import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { handleValidationErrors } from '../../middleware/validation';
import * as controller from './ratingController';
import * as validators from './ratingValidators';

const router = Router();

router.use(authenticate);

// POST /api/v1/ratings/:transactionId — submit a rating for a completed transaction
router.post(
  '/:transactionId',
  validators.submitRatingValidator,
  handleValidationErrors,
  controller.submitRating,
);

// GET /api/v1/ratings/transaction/:transactionId — get all ratings for a transaction
router.get('/transaction/:transactionId', controller.getTransactionRatings);

// GET /api/v1/ratings/me — get current user's rating summary
router.get('/me', controller.getMyRatingSummary);

// GET /api/v1/ratings/user/:userId — get a user's ratings & summary
router.get(
  '/user/:userId',
  validators.getUserRatingsValidator,
  handleValidationErrors,
  controller.getUserRatings,
);

export default router;
