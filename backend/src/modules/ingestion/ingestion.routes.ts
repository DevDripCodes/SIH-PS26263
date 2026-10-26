import ExcelJS from "exceljs";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { FIELDS, REQUIRED_FIELDS, applyMapping, buildMapping } from "./columns.js";
import {
  IngestionError,
  getBatch,
  ingest,
  listBatches,
  listInstitutions,
  previewSheet,
  type SourceChannel,
} from "./ingestion.service.js";
import { ParseError, parseCsv, parseExcel, type ParsedSheet } from "./parsers.js";
import { requireRoles } from "../auth/auth.middleware.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FORM_RECORDS = 500;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});

const batchScope = z.object({
  // TODO(auth): take institutionId from the nodal officer's Keycloak token instead of the request.
  institutionId: z.uuid({ error: "Select an institution." }),
  academicYear: z.string().regex(/^\d{4}-\d{2}$/, { error: "Academic year must look like 2026-27." }),
});

const formRecord = z.object(Object.fromEntries(FIELDS.map((f) => [f, z.string().trim().max(500).optional()])));

const formBody = batchScope.extend({
  records: z.array(formRecord).min(1, { error: "Add at least one student." }).max(MAX_FORM_RECORDS, {
    error: `A form submission can hold at most ${MAX_FORM_RECORDS} students. Use CSV/Excel upload for more.`,
  }),
});

type FileKind = "csv" | "excel";

function detectKind(file: Express.Multer.File): FileKind {
  const name = file.originalname.toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".xlsx")) return "excel";
  if (name.endsWith(".xls")) {
    throw new IngestionError("Old .xls files are not supported. Open the file in Excel and save it as .xlsx.", 415);
  }
  throw new IngestionError("Upload a .csv or .xlsx file.", 415);
}

async function readSheet(file: Express.Multer.File | undefined): Promise<{ kind: FileKind; sheet: ParsedSheet }> {
  if (!file) throw new IngestionError("Attach a file in the 'file' field.", 400);
  const kind = detectKind(file);
  const sheet = kind === "csv" ? parseCsv(file.buffer) : await parseExcel(file.buffer);
  if (sheet.rows.length === 0) throw new IngestionError("The file has a header row but no student rows.", 422);
  return { kind, sheet };
}

function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new IngestionError(result.error.issues[0]?.message ?? "Invalid request.", 400, z.flattenError(result.error));
  }
  return result.data;
}

export const ingestionRouter = Router();

function actorFor(req: Request): AuthenticatedUser {
  const actor = req.authenticatedUser;
  if (!actor) throw new IngestionError("Authentication required.", 401);
  return actor;
}

function assertInstitutionAccess(actor: AuthenticatedUser, institutionId: string): void {
  if (actor.role === "AICTE_SUPER_ADMIN") return;
  if (actor.role === "INSTITUTION_NODAL_OFFICER" && actor.institutionId === institutionId) return;
  throw new IngestionError("Authorization request denied.", 403);
}

ingestionRouter.get("/institutions", async (_req, res) => {
  res.json({ institutions: await listInstitutions() });
});

ingestionRouter.get("/fields", (_req, res) => {
  res.json({ fields: FIELDS, required: REQUIRED_FIELDS });
});

const TEMPLATE_EXAMPLE: Partial<Record<(typeof FIELDS)[number], string>> = {
  apaar_id: "123456789012",
  full_name: "Aarav Sharma",
  date_of_birth: "2007-05-14",
  gender: "Male",
  email: "aarav@example.com",
  mobile: "9876543210",
  roll_no: "2026CSE001",
  program_code: "1-1234567890",
  admission_date: "2026-08-01",
  social_category: "GEN",
  residency_status: "INDIAN_RESIDENT",
  seat_quota_type: "REGULAR_SANCTIONED",
  is_fn: "N",
  is_oci_status: "N",
  nationality: "Indian",
};

ingestionRouter.get("/template", async (req, res) => {
  const example = FIELDS.map((f) => TEMPLATE_EXAMPLE[f] ?? "");
  if (req.query.format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Enrolments");
    sheet.addRow([...FIELDS]).font = { bold: true };
    sheet.addRow(example);
    sheet.columns.forEach((col) => {
      col.width = 20;
      col.numFmt = "@"; // keep APAAR IDs / mobiles as text so Excel doesn't drop digits
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="apaar_enrolment_template.xlsx"');
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  } else {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="apaar_enrolment_template.csv"');
    res.send(`${FIELDS.join(",")}\n${example.join(",")}\n`);
  }
});

/** Parse a file and report how its columns map, without writing anything. */
ingestionRouter.post("/preview", requireRoles("AICTE_SUPER_ADMIN", "INSTITUTION_NODAL_OFFICER"), upload.single("file"), async (req, res) => {
  const { kind, sheet } = await readSheet(req.file);
  res.json({ kind, ...previewSheet(sheet) });
});

/** Stage 1: land every row of a CSV/Excel file in staging and return the new batch (HTTP 202). */
ingestionRouter.post("/upload", requireRoles("AICTE_SUPER_ADMIN", "INSTITUTION_NODAL_OFFICER"), upload.single("file"), async (req, res) => {
  const scope = parseOrThrow(batchScope, req.body);
  const actor = actorFor(req);
  assertInstitutionAccess(actor, scope.institutionId);
  const { kind, sheet } = await readSheet(req.file);

  const mapping = buildMapping(sheet.headers);
  const blocking = mapping.missingRequired.filter((f) => f === "apaar_id" || f === "full_name");
  if (blocking.length) {
    throw new IngestionError(
      `The file has no ${blocking.join(" / ")} column. Check the header row against the template.`,
      422,
      { mapping },
    );
  }

  const source: SourceChannel = kind === "csv" ? "CSV_UPLOAD" : "EXCEL_UPLOAD";
  const batch = await ingest({
    ...scope,
    submittedBy: actor.userId,
    source,
    filename: req.file!.originalname,
    file: req.file!.buffer,
    allowDuplicateFile: req.body.allowDuplicate === "true",
    rows: sheet.rows.map((r, i) => ({ row: applyMapping(r, mapping), sourceRowNumber: sheet.rowNumbers[i] ?? i + 2 })),
  });
  res.status(202).json({ batch, mapping });
});

/** Stage 1 for students keyed in through the web form. */
ingestionRouter.post("/form", requireRoles("AICTE_SUPER_ADMIN", "INSTITUTION_NODAL_OFFICER"), async (req, res) => {
  const body = parseOrThrow(formBody, req.body);
  const actor = actorFor(req);
  assertInstitutionAccess(actor, body.institutionId);
  const batch = await ingest({
    institutionId: body.institutionId,
    academicYear: body.academicYear,
    submittedBy: actor.userId,
    source: "WEB_FORM",
    filename: null,
    rows: body.records.map((row, i) => ({ row, sourceRowNumber: i + 1 })),
  });
  res.status(202).json({ batch });
});

ingestionRouter.get("/batches", async (req, res) => {
  const institutionId = parseOrThrow(z.uuid(), req.query.institutionId);
  assertInstitutionAccess(actorFor(req), institutionId);
  res.json({ batches: await listBatches(institutionId) });
});

ingestionRouter.get("/batches/:batchId", async (req, res) => {
  const batchId = parseOrThrow(z.uuid(), req.params.batchId);
  const actor = actorFor(req);
  if (actor.role !== "AICTE_SUPER_ADMIN" && actor.role !== "INSTITUTION_NODAL_OFFICER") {
    throw new IngestionError("Authorization request denied.", 403);
  }
  if (actor.role === "INSTITUTION_NODAL_OFFICER" && !actor.institutionId) {
    throw new IngestionError("Authorization request denied.", 403);
  }
  const batch = await getBatch(batchId, actor.role === "AICTE_SUPER_ADMIN" ? undefined : actor.institutionId ?? undefined);
  if (!batch) throw new IngestionError("Batch not found.", 404);
  res.json({ batch });
});

export function ingestionErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (err instanceof IngestionError) {
    res.status(err.status).json({ error: err.message, details: err.details });
  } else if (err instanceof ParseError) {
    res.status(422).json({ error: err.message });
  } else if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE" ? `File is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.` : err.message;
    res.status(413).json({ error: message });
  } else {
    next(err);
  }
}
