import { body, query } from 'express-validator';

export const setPinValidator = [
  body('pin')
    .isLength({ min: 4, max: 6 })
    .withMessage('PIN must be 4-6 digits')
    .matches(/^\d+$/)
    .withMessage('PIN must contain only digits'),
];

export const changePinValidator = [
  body('old_pin')
    .notEmpty()
    .withMessage('Current PIN is required'),
  body('new_pin')
    .isLength({ min: 4, max: 6 })
    .withMessage('New PIN must be 4-6 digits')
    .matches(/^\d+$/)
    .withMessage('PIN must contain only digits'),
];

export const fundWalletValidator = [
  body('amount')
    .isNumeric()
    .withMessage('Amount must be a valid number')
    .custom((val) => parseFloat(val) >= 1)
    .withMessage('Minimum funding amount is 1.00')
    .custom((val) => parseFloat(val) <= 10000000)
    .withMessage('Maximum funding amount is 10,000,000'),
  body('callback_url')
    .optional()
    .isString()
    .withMessage('Invalid callback URL'),
];

export const withdrawValidator = [
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

export const transactionHistoryValidator = [
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
    .isIn(['funding', 'withdrawal', 'escrow_lock', 'escrow_release', 'escrow_refund'])
    .withMessage('Invalid transaction type'),
  query('from')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format'),
  query('to')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format'),
];

export const updateLimitsValidator = [
  body('daily_limit')
    .optional()
    .isDecimal({ decimal_digits: '0,2' })
    .withMessage('Daily limit must be a valid number')
    .custom((val) => parseFloat(val) >= 1000)
    .withMessage('Minimum daily limit is NGN 1,000'),
  body('monthly_limit')
    .optional()
    .isDecimal({ decimal_digits: '0,2' })
    .withMessage('Monthly limit must be a valid number')
    .custom((val) => parseFloat(val) >= 10000)
    .withMessage('Minimum monthly limit is NGN 10,000'),
  body('pin')
    .notEmpty()
    .withMessage('Transaction PIN is required'),
];
