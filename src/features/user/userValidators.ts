import { body } from 'express-validator';

// { values: 'falsy' } makes .optional() skip validation for empty strings, null, and undefined
// This prevents validation errors when the frontend sends empty string fields for unchanged values
export const updateProfileValidator = [
  body('name')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 2, max: 255 })
    .withMessage('Name must be between 2 and 255 characters'),
  body('phone_number')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 10, max: 50 })
    .withMessage('Phone number must be between 10 and 50 characters'),
  body('username')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers and underscores'),
  body('bio')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Bio cannot exceed 500 characters'),
  body('location')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 255 })
    .withMessage('Location cannot exceed 255 characters'),
  body('profile_photo')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Profile photo must be a string'),
];

export const changePasswordValidator = [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password')
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain uppercase, lowercase, and number'),
];
