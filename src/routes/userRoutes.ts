import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  changePassword,
} from '../controllers/userController';
import {
  updateProfileValidator,
  changePasswordValidator,
} from '../validators/userValidators';
import { handleValidationErrors } from '../middleware/validation';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/me', getProfile);

router.patch(
  '/me',
  updateProfileValidator,
  handleValidationErrors,
  updateProfile
);

router.post(
  '/change-password',
  changePasswordValidator,
  handleValidationErrors,
  changePassword
);

export default router;
