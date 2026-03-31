import { body, param, query } from 'express-validator';

export const depositValidator = [
  body('amount')
    .isDecimal({ decimal_digits: '0,2' })
    .withMessage('Amount must be a valid number')
    .custom((val) => parseFloat(val) >= 100)
    .withMessage('Minimum deposit amount is NGN 100')
    .custom((val) => parseFloat(val) <= 10000000)
    .withMessage('Maximum deposit amount is NGN 10,000,000'),
  body('callback_url')
    .optional()
    .isURL()
    .withMessage('Invalid callback URL'),
];

export const withdrawalValidator = [
  body('amount')
    .isDecimal({ decimal_digits: '0,2' })
    .withMessage('Amount must be a valid number')
    .custom((val) => parseFloat(val) >= 100)
    .withMessage('Minimum withdrawal is NGN 100')
    .custom((val) => parseFloat(val) <= 5000000)
    .withMessage('Maximum withdrawal is NGN 5,000,000'),
  body('payment_method_id')
    .isUUID()
    .withMessage('Valid payment method ID is required'),
  body('pin')
    .notEmpty()
    .withMessage('Transaction PIN is required'),
];

export const escrowValidator = [
  body('receiver_email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid receiver email is required'),
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
  body('amount')
    .isDecimal({ decimal_digits: '0,2' })
    .withMessage('Amount must be a valid number')
    .custom((val) => parseFloat(val) >= 100)
    .withMessage('Minimum escrow amount is NGN 100')
    .custom((val) => parseFloat(val) <= 10000000)
    .withMessage('Maximum escrow amount is NGN 10,000,000'),
  body('delivery_window')
    .notEmpty()
    .withMessage('Delivery window is required')
    .isString()
    .withMessage('Delivery window must be a valid duration string (e.g. "3 days", "72 hours", "1 week")'),
  body('pin')
    .notEmpty()
    .withMessage('Transaction PIN is required'),
];

export const confirmDeliveryValidator = [
  param('id')
    .isUUID()
    .withMessage('Valid transaction ID is required'),
];

export const confirmReceiptValidator = [
  param('id')
    .isUUID()
    .withMessage('Valid transaction ID is required'),
  body('pin')
    .notEmpty()
    .withMessage('Transaction PIN is required'),
];

export const transactionListValidator = [
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
  query('type')
    .optional()
    .isIn(['deposit', 'withdrawal', 'escrow'])
    .withMessage('Type must be deposit, withdrawal, or escrow'),
  query('status')
    .optional()
    .isString()
    .withMessage('Invalid status'),
  query('from')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format'),
  query('to')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format'),
];

export const transactionByIdValidator = [
  param('id')
    .isUUID()
    .withMessage('Valid transaction ID is required'),
];
