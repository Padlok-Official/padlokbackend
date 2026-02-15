import { Router } from 'express';
import {
  register,
  login,
  refreshToken,
  logout,
} from '../controllers/authController';
import {
  registerValidator,
  loginValidator,
  refreshTokenValidator,
} from '../validators/authValidators';
import { handleValidationErrors } from '../middleware/validation';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/security';

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

router.post('/logout', authenticate, logout);

export default router;
