import { body, param, query } from 'express-validator';

export const initiateEscrowValidator = [
  body('seller_email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid seller email is required'),
  body('item_description')
    .isString()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Item description must be 10-1000 characters'),
  body('item_photos')
    .isArray({ min: 1, max: 10 })
    .withMessage('At least 1 photo is required (max 10)'),
  body('item_photos.*')
    .isURL()
    .withMessage('Each photo must be a valid URL'),
  body('price')
    .isDecimal({ decimal_digits: '0,2' })
    .withMessage('Price must be a valid number')
    .custom((val) => parseFloat(val) >= 100)
    .withMessage('Minimum escrow amount is NGN 100')
    .custom((val) => parseFloat(val) <= 10000000)
    .withMessage('Maximum escrow amount is NGN 10,000,000'),
  body('pin')
    .notEmpty()
    .withMessage('Transaction PIN is required'),
];

export const setDeliveryValidator = [
  param('id')
    .isUUID()
    .withMessage('Valid escrow transaction ID is required'),
  body('delivery_hours')
    .isInt()
    .isIn([1, 2, 3, 6, 12, 24, 48, 72])
    .withMessage('delivery_hours must be one of: 1, 2, 3, 6, 12, 24, 48, 72'),
];

export const confirmDeliveryValidator = [
  param('id')
    .isUUID()
    .withMessage('Valid escrow transaction ID is required'),
];

export const confirmReceiptValidator = [
  param('id')
    .isUUID()
    .withMessage('Valid escrow transaction ID is required'),
  body('pin')
    .notEmpty()
    .withMessage('Transaction PIN is required'),
];

export const raiseDisputeValidator = [
  param('id')
    .isUUID()
    .withMessage('Valid escrow transaction ID is required'),
  body('reason')
    .isString()
    .isLength({ min: 20, max: 2000 })
    .withMessage('Dispute reason must be 20-2000 characters'),
  body('evidence_photos')
    .optional()
    .isArray({ max: 10 })
    .withMessage('Max 10 evidence photos'),
  body('evidence_photos.*')
    .optional()
    .isURL()
    .withMessage('Each photo must be a valid URL'),
];

export const resolveDisputeValidator = [
  param('id')
    .isUUID()
    .withMessage('Valid dispute ID is required'),
  body('resolution')
    .isIn(['refund', 'release'])
    .withMessage('Resolution must be either "refund" or "release"'),
  body('admin_notes')
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage('Admin notes must be 2000 characters or fewer'),
];

export const escrowListValidator = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .toInt()
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .toInt()
    .withMessage('Limit must be between 1 and 100'),
  query('role')
    .optional()
    .isIn(['buyer', 'seller'])
    .withMessage('Role must be buyer or seller'),
  query('status')
    .optional()
    .isIn(['initiated', 'funded', 'delivery_confirmed', 'completed', 'disputed', 'refunded', 'cancelled'])
    .withMessage('Invalid status'),
];
