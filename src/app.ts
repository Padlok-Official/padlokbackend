import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import db from "./config/database";
import { errorHandler } from "./middleware/errorHandler";
import { generalLimiter } from "./middleware/security";
import authRoutes from "./routes/authRoutes";
import otpRoutes from "./routes/otpRoutes";
import userRoutes from "./routes/userRoutes";
import adminRoutes from "./routes/adminRoutes";
import walletRoutes from "./routes/walletRoute";
import escrowRoutes from "./routes/escrowRoutes";
import paymentMethodRoutes from "./routes/paymentMethodRoutes";
import transactionRoutes from "./routes/transactionRoutes";
import webhookRoutes from "./routes/webhookRoutes";

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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(generalLimiter);

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/user", userRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/v1/escrow", escrowRoutes);
app.use("/api/v1/transactions", transactionRoutes);
app.use("/api/v1/payment-methods", paymentMethodRoutes);
app.use("/api/v1/otp", otpRoutes);
app.use("/api/v1/admin", adminRoutes);

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
