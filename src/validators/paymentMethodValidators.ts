import { body, param } from 'express-validator';

export const addBankAccountValidator = [
  body('bank_code')
    .notEmpty()
    .withMessage('Bank code is required'),
  body('account_number')
    .isLength({ min: 10, max: 10 })
    .withMessage('Account number must be 10 digits')
    .matches(/^\d{10}$/)
    .withMessage('Account number must contain only digits'),
];

export const addMobileMoneyValidator = [
  body('provider')
    .notEmpty()
    .withMessage('Mobile money provider is required')
    .isIn(['mtn', 'airtel', 'vodafone'])
    .withMessage('Provider must be one of: mtn, airtel, vodafone'),
  body('phone_number')
    .notEmpty()
    .withMessage('Phone number is required')
    .isLength({ min: 10, max: 10 })
    .withMessage('Phone number must be 10 digits')
    .matches(/^\d{10}$/)
    .withMessage('Phone number must contain only digits'),
  body('account_name')
    .notEmpty()
    .withMessage('Account holder name is required'),
];

export const setDefaultValidator = [
  param('id')
    .isUUID()
    .withMessage('Valid payment method ID is required'),
];

export const deletePaymentMethodValidator = [
  param('id')
    .isUUID()
    .withMessage('Valid payment method ID is required'),
];
