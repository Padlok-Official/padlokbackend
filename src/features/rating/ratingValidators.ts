import { body, param } from 'express-validator';

export const submitRatingValidator = [
  param('transactionId')
    .isUUID()
    .withMessage('Valid transaction ID is required'),
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment')
    .optional({ values: 'falsy' })
    .isString()
    .isLength({ max: 500 })
    .withMessage('Comment must be 500 characters or fewer'),
];

export const getUserRatingsValidator = [
  param('userId')
    .isUUID()
    .withMessage('Valid user ID is required'),
];
