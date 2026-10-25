import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ingestionErrorHandler, ingestionRouter } from "./modules/ingestion/ingestion.routes.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "http://localhost:5173" }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/v1/ingestion", ingestionRouter, ingestionErrorHandler);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
