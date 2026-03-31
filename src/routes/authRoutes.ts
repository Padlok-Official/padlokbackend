import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
  setAppPin,
  verifyAppPin,
  changeAppPin,
} from '../controllers/authController';
import {
  registerValidator,
  loginValidator,
  refreshTokenValidator,
  setAppPinValidator,
  verifyAppPinValidator,
  changeAppPinValidator,
} from '../validators/authValidators';
import { handleValidationErrors } from '../middleware/validation';
import { authenticate } from '../middleware/auth';
import { authLimiter, pinLimiter } from '../middleware/security';

const router = Router();

router.post(
  '/register',
  authLimiter,
  registerValidator,
  handleValidationErrors,
  register
);

router.post(
  '/login',
  authLimiter,
  loginValidator,
  handleValidationErrors,
  login
);

router.post(
  '/refresh',
  authLimiter,
  refreshTokenValidator,
  handleValidationErrors,
  refreshToken
);

router.post('/logout', authLimiter, logout);

// App PIN endpoints
router.post(
  '/pin',
  authenticate,
  pinLimiter,
  setAppPinValidator,
  handleValidationErrors,
  setAppPin
);

router.post(
  '/pin/verify',
  authenticate,
  pinLimiter,
  verifyAppPinValidator,
  handleValidationErrors,
  verifyAppPin
);

router.put(
  '/pin',
  authenticate,
  pinLimiter,
  changeAppPinValidator,
  handleValidationErrors,
  changeAppPin
);

export default router;
