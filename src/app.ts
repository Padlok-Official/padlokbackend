import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import db from "./config/database";
import logger from "./utils/logger";
import { errorHandler } from "./middleware/errorHandler";
import { generalLimiter } from "./middleware/security";
import authRoutes from "./features/auth/authRoutes";
import otpRoutes from "./features/otp/otpRoutes";
import userRoutes from "./features/user/userRoutes";
import adminRoutes from "./features/admin/adminRoutes";
import walletRoutes from "./features/wallet/walletRoutes";
import escrowRoutes from "./features/escrow/escrowRoutes";
import paymentMethodRoutes from "./features/paymentMethod/paymentMethodRoutes";
import transactionRoutes from "./features/transaction/transactionRoutes";
import webhookRoutes from "./features/webhook/webhookRoutes";

const app = express();

// Trust proxy for deployments behind reverse proxies (Vercel, Railway, etc.)
app.set("trust proxy", 1);

// Webhook routes MUST be registered BEFORE express.json() middleware
// because Paystack webhook needs the raw body for HMAC signature verification
app.use("/api/v1/webhooks", webhookRoutes);

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "*",
    credentials: false,
  }),
);
app.use(compression() as unknown as express.RequestHandler);
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));
app.use(generalLimiter);

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/user", userRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/escrow", escrowRoutes);
app.use("/api/v1/transactions", transactionRoutes);
app.use("/api/v1/payment-methods", paymentMethodRoutes);
app.use("/api/v1/otp", otpRoutes);
app.use("/api/v1/admin", adminRoutes);

app.get("/api/v1", (req, res) => {
  res.send("API is running 🚀");
});

app.get("/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({
      success: true,
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      status: "unhealthy",
      database: "disconnected",
      timestamp: new Date().toISOString(),
    });
  }
});

app.use(errorHandler);

export default app;
