import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { authRouter } from "./modules/auth/auth.routes.js";
import { requireAuthenticated } from "./modules/auth/auth.middleware.js";
import { rolesRouter } from "./modules/auth/roles.routes.js";
import { ingestionErrorHandler, ingestionRouter } from "./modules/ingestion/ingestion.routes.js";
import { validationErrorHandler, validationRouter } from "./modules/validation/validation.routes.js";
import { redisUrl } from "./config/redis.js";
import { startValidationWorker } from "./jobs/processors/validation.processor.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/roles", rolesRouter);
app.use("/api/v1/ingestion", requireAuthenticated, ingestionRouter, ingestionErrorHandler);
app.use("/api/v1/validation", requireAuthenticated, validationRouter, validationErrorHandler);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

// Validation jobs: with REDIS_URL they go through BullMQ (worker started here unless WORKER_IN_API=false,
// e.g. when running `npm run dev:worker` separately); without it they run inline in this process.
if (redisUrl() && process.env.WORKER_IN_API !== "false") {
  startValidationWorker();
  console.log("Validation worker started in the API process.");
} else if (!redisUrl()) {
  console.log("REDIS_URL not set: validation jobs run inline in the API process.");
}
