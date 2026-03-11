import { Router } from 'express';
import {
  changePassword,
  getProfile,
  searchUsers,
  updateFcmToken,
  updateProfile,
} from '../controllers/userController';
import { authenticate } from '../middleware/auth';
import { handleValidationErrors } from '../middleware/validation';
import {
  changePasswordValidator,
  updateProfileValidator,
} from '../validators/userValidators';

const router = Router();

router.use(authenticate);

router.get('/me', getProfile);
router.get('/profile', getProfile);
router.get('/search', searchUsers);

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

router.put('/fcm-token', updateFcmToken);

export default router;
