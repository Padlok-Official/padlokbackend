import logger from './utils/logger';
import "dotenv/config";
import http from "http";
import app from "./app";
import db from "./config/database";
import socketService from "./infrastructure/socket/socketService";
import { setupPaystackWorker } from "./workers/paystackWorker";

const PORT = Number(process.env.PORT) || 6000;

process.on("uncaughtException", (error: Error) => {
  logger.error({ err: error }, "Uncaught Exception");
  logger.error(`Stack: ${error.stack}`);
  setTimeout(() => process.exit(1), 1000);
});

process.on(
  "unhandledRejection",
  (reason: unknown, promise: Promise<unknown>) => {
    logger.error({ data: promise }, "Unhandled Rejection");
    logger.error({ data: reason }, "Unhandled rejection reason");
    setTimeout(() => process.exit(1), 1000);
  },
);

async function startServer(): Promise<void> {
  try {
    await db.connect();

    const httpServer = http.createServer(app);

    const server = httpServer.listen(PORT, "0.0.0.0", () => {
      logger.info(
        `Server running on port ${PORT} (${process.env.NODE_ENV ?? "development"})`,
      );
    });

    await socketService.initialize(server);

    const worker = setupPaystackWorker();

    const shutdown = (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);
      server.close(async () => {
        await worker.close();
        await db.disconnect();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

startServer();
