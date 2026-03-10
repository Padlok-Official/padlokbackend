import "dotenv/config";
import fs from "fs";
import https from "https";
import app from "./app";
import db from "./config/database";

const PORT = Number(process.env.PORT) || 6000;

process.on("uncaughtException", (error: Error) => {
  console.error("Uncaught Exception:", error);
  console.error("Stack:", error.stack);
  setTimeout(() => process.exit(1), 1000);
});

process.on(
  "unhandledRejection",
  (reason: unknown, promise: Promise<unknown>) => {
    console.error("Unhandled Rejection at:", promise);
    console.error("Reason:", reason);
    setTimeout(() => process.exit(1), 1000);
  },
);

async function startServer(): Promise<void> {
  try {
    await db.connect();

    let server;
    if (
      process.env.NODE_ENV !== "production" &&
      fs.existsSync("./certs/key.pem")
    ) {
      const options = {
        key: fs.readFileSync("./certs/key.pem"),
        cert: fs.readFileSync("./certs/cert.pem"),
      };
      server = https.createServer(options, app).listen(PORT, () => {
        console.log(
          `HTTPS server running on https://localhost:${PORT} (${process.env.NODE_ENV ?? "development"})`,
        );
      });
    } else {
      server = app.listen(PORT, () => {
        console.log(
          `Server running on port ${PORT} (${process.env.NODE_ENV ?? "development"})`,
        );
      });
    }

    const shutdown = (signal: string) => {
      console.log(`${signal} received, shutting down gracefully...`);
      server.close(async () => {
        await db.disconnect();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
