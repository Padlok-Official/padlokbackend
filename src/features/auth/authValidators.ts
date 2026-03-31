import { body } from 'express-validator';

export const registerValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 255 })
    .withMessage('Name must be between 2 and 255 characters'),
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  body('phone_number')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required')
    .isLength({ min: 10, max: 50 })
    .withMessage('Phone number must be between 10 and 50 characters'),
];

export const loginValidator = [
  body('email').trim().notEmpty().withMessage('Email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

export const setAppPinValidator = [
  body('pin')
    .notEmpty()
    .withMessage('PIN is required')
    .isLength({ min: 4, max: 6 })
    .withMessage('PIN must be 4 to 6 digits')
    .matches(/^\d+$/)
    .withMessage('PIN must contain only digits'),
];

export const verifyAppPinValidator = [
  body('pin')
    .notEmpty()
    .withMessage('PIN is required'),
];

export const changeAppPinValidator = [
  body('old_pin')
    .notEmpty()
    .withMessage('Current PIN is required'),
  body('new_pin')
    .notEmpty()
    .withMessage('New PIN is required')
    .isLength({ min: 4, max: 6 })
    .withMessage('PIN must be 4 to 6 digits')
    .matches(/^\d+$/)
    .withMessage('PIN must contain only digits'),
];

export const refreshTokenValidator = [
  body('refreshToken').notEmpty().withMessage('Refresh token is required'),
];
