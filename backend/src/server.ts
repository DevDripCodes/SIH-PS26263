import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { authRouter } from "./modules/auth/auth.routes.js";
import { requireAuthenticated } from "./modules/auth/auth.middleware.js";
import { rolesRouter } from "./modules/auth/roles.routes.js";
import { ingestionErrorHandler, ingestionRouter } from "./modules/ingestion/ingestion.routes.js";

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

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
