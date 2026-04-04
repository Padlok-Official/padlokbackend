import logger from './utils/logger';
import "dotenv/config";
import http from "http";
import app from "./app";
import db from "./config/database";
import { redisConnection } from "./config/redis";
import socketService from "./infrastructure/socket/socketService";
import { setupPaystackWorker } from "./workers/paystackWorker";
import { notificationWorker } from "./infrastructure/notification/notificationQueue";

const PORT = Number(process.env.PORT) || 6000;
const SHUTDOWN_TIMEOUT = 15000;

process.on("uncaughtException", (error: Error) => {
  logger.error({ err: error }, "Uncaught Exception");
  setTimeout(() => process.exit(1), 3000);
});

process.on(
  "unhandledRejection",
  (reason: unknown, promise: Promise<unknown>) => {
    logger.error({ data: { promise, reason } }, "Unhandled Rejection");
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

    // Keep-alive timeout should be higher than any reverse proxy timeout
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;

    await socketService.initialize(server);

    const paystackWorkerInstance = setupPaystackWorker();
    const notificationWorkerInstance = notificationWorker.start();

    let isShuttingDown = false;

    const shutdown = async (signal: string) => {
      if (isShuttingDown) return;
      isShuttingDown = true;

      logger.info(`${signal} received, shutting down gracefully...`);

      // Hard exit after timeout to prevent hanging
      const forceExit = setTimeout(() => {
        logger.error('Graceful shutdown timed out, forcing exit');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT);
      forceExit.unref();

      try {
        // 1. Stop accepting new connections
        server.close();

        // 2. Close Socket.io (disconnects all clients, closes Redis pub/sub)
        await socketService.close();

        // 3. Close background workers
        await paystackWorkerInstance.close();
        await notificationWorkerInstance.close();

        // 4. Close Redis
        redisConnection.disconnect();

        // 5. Close database pool
        await db.disconnect();

        logger.info('All resources closed, exiting');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

startServer();
