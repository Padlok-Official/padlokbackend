import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { otpService } from './otpService';

function checkValidation(req: Request, res: Response): boolean {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });
    return false;
  }
  return true;
}

const otpController = {
  sendOTP: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkValidation(req, res)) return;
    try {
      await otpService.sendOTP(req.body.email);
      res.status(200).json({ success: true, message: 'OTP sent successfully to your email', data: { email: req.body.email, expiresIn: '30 minutes' } });
    } catch (err) { next(err); }
  },

  verifyOTP: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkValidation(req, res)) return;
    try {
      await otpService.verifyOTP(req.body.email, req.body.otp);
      res.status(200).json({ success: true, message: 'Email verified successfully', data: { email: req.body.email, verified: true } });
    } catch (err) { next(err); }
  },

  resendOTP: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkValidation(req, res)) return;
    try {
      await otpService.resendOTP(req.body.email);
      res.status(200).json({ success: true, message: 'OTP resent successfully to your email', data: { email: req.body.email, expiresIn: '30 minutes' } });
    } catch (err) { next(err); }
  },

  checkVerification: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = req.params;
      if (!email) { res.status(400).json({ success: false, message: 'Email parameter is required' }); return; }
      const data = await otpService.checkVerification(email);
      res.status(200).json({ success: true, data: { email, ...data } });
    } catch (err) { next(err); }
  },
};

export default otpController;
