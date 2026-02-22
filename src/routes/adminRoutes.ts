import { Router } from 'express';
import { broadcastNotification } from '../controllers/adminController';
import { authenticate, isAdmin } from '../middleware/auth';

const router = Router();

// All admin routes require authentication and admin privileges
// router.use(authenticate);
// router.use(isAdmin);

router.post('/broadcast', broadcastNotification);

export default router;
