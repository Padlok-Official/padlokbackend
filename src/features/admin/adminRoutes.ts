import { Router } from "express";
import { broadcastNotification } from "./adminController";
import { authenticate, isAdmin } from "../../middleware/auth";

const router = Router();

router.post("/broadcast", broadcastNotification);

export default router;
