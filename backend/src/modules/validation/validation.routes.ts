import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireRoles } from "../auth/auth.middleware.js";
import { actorFor, assertInstitutionAccess } from "../auth/institution-access.js";
import { getBatch } from "../ingestion/ingestion.service.js";
import { HttpError } from "../../utils/http-error.js";
import { forecastPromotion } from "./stages/l3.stage.js";
import {
  approveBatch,
  cancelBatch,
  correctionsCsv,
  getValidationSummary,
  listAnomalies,
  loadBatchHeader,
  retryBatch,
} from "./validation.service.js";

export const validationRouter = Router();

validationRouter.use(requireRoles("AICTE_SUPER_ADMIN", "INSTITUTION_NODAL_OFFICER"));

/** Loads the batch named in the URL and checks the caller may see it. */
async function batchFor(req: Request) {
  const parsed = z.uuid().safeParse(req.params.batchId);
  if (!parsed.success) throw new HttpError("Batch not found.", 404);
  const header = await loadBatchHeader(parsed.data);
  assertInstitutionAccess(actorFor(req), header.institutionId);
  return header;
}

validationRouter.get("/batches/:batchId", async (req, res) => {
  const { batchId } = await batchFor(req);
  const [batch, summary] = await Promise.all([getBatch(batchId), getValidationSummary(batchId)]);
  res.json({ batch, ...summary });
});

const anomalyQuery = z.object({
  level: z.coerce.number().int().min(1).max(3).optional(),
  severity: z.enum(["ERROR", "WARNING"]).optional(),
  code: z.string().regex(/^[A-Z_]+$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

validationRouter.get("/batches/:batchId/anomalies", async (req, res) => {
  const { batchId } = await batchFor(req);
  const query = anomalyQuery.safeParse(req.query);
  if (!query.success) throw new HttpError("Invalid filter.", 400, z.flattenError(query.error));
  res.json(await listAnomalies(batchId, query.data));
});

validationRouter.get("/batches/:batchId/corrections.csv", async (req, res) => {
  const { batchId } = await batchFor(req);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="corrections_${batchId.slice(0, 8)}.csv"`);
  res.send(await correctionsCsv(batchId));
});

/** Dry run of the database's L3 checks (seat caps, cross-institution, cut-off). Nothing is saved. */
validationRouter.post("/batches/:batchId/precheck", async (req, res) => {
  const { batchId, status } = await batchFor(req);
  if (status !== "L2_COMPLETED") throw new HttpError("The batch is not waiting for approval.", 409);
  res.json({ forecast: await forecastPromotion(batchId) });
});

validationRouter.post("/batches/:batchId/approve", async (req, res) => {
  const { batchId } = await batchFor(req);
  await approveBatch(batchId, actorFor(req).userId);
  res.status(202).json({ batch: await getBatch(batchId) });
});

validationRouter.post("/batches/:batchId/cancel", async (req, res) => {
  const { batchId } = await batchFor(req);
  await cancelBatch(batchId);
  res.json({ batch: await getBatch(batchId) });
});

validationRouter.post("/batches/:batchId/retry", async (req, res) => {
  const { batchId } = await batchFor(req);
  await retryBatch(batchId);
  res.status(202).json({ batch: await getBatch(batchId) });
});

export function validationErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof HttpError) res.status(err.status).json({ error: err.message, details: err.details });
  else next(err);
}
