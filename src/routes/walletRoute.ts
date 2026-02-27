import express from 'express';
import { getUserWallet } from '../controllers/walletController';
const router = express.Router();

router.get('/user-wallet/:userId', getUserWallet);

export default router;
