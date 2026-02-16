import express, { Router } from 'express';
import otpController from '../controllers/otpController';
import { otpValidation, handleValidationErrors } from '../middleware/validation';

const router: Router = express.Router();

/**
 * @route   POST /api/otp/send-otp
 * @desc    Send OTP to email for verification
 * @access  Public
 */
router.post(
    '/send-otp',
    otpValidation.sendOTP,
    handleValidationErrors,
    otpController.sendOTP
);

/**
 * @route   POST /api/otp/verify-otp
 * @desc    Verify OTP code
 * @access  Public
 */
router.post(
    '/verify-otp',
    otpValidation.verifyOTP,
    handleValidationErrors,
    otpController.verifyOTP
);

/**
 * @route   POST /api/otp/resend-otp
 * @desc    Resend OTP to email
 * @access  Public
 */
router.post(
    '/resend-otp',
    otpValidation.resendOTP,
    handleValidationErrors,
    otpController.resendOTP
);

/**
 * @route   GET /api/otp/check-verification/:email
 * @desc    Check if email is verified
 * @access  Public
 */
router.get(
    '/check-verification/:email',
    otpValidation.checkVerification,
    handleValidationErrors,
    otpController.checkVerification
);

export default router;
