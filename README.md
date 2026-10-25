# APAAR-Based Student Data Management & Verification Platform (SIH PS26263)

Architecture: [docs/APAAR_Platform_Architecture.drawio](docs/APAAR_Platform_Architecture.drawio) · Tech stack: [docs/tech-stack.jpeg](docs/tech-stack.jpeg)

| Component | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind |
| Backend | Node.js (LTS), Express, TypeScript, REST |
| Auth | Keycloak (OIDC/MFA), OAuth2, RBAC |
| Database | PostgreSQL (Prisma) |
| Background jobs | BullMQ, Redis |
| Integrations | REST adapters |
| Security | AES-256 field encryption, masked APAAR IDs, signed QR verification |
| Monitoring | OpenTelemetry |

## Layout

```
backend/
  prisma/             schema + migrations (Institution, Program, Student, Enrolment, Consent, ...)
  src/modules/        ingestion, validation, workflow (maker-checker), anomaly, consent,
                      verification, reports, notifications, audit, auth, core entities
  src/integrations/   APAAR registry, DigiLocker, AICTE approval, NSP, AISHE, degree bodies
  src/jobs/           BullMQ queues + processors
  src/lib/            crypto, ledger (Merkle anchoring), telemetry
frontend/
  src/pages/          institution, approver, aicte-admin, regional, verifier, student, public
  src/features/       upload, validation, approvals, dashboards, consent, verification, reports
```

## Data ingestion (Stage 1)

Institutions submit enrolments three ways from the dashboard's **Data Upload** tab (`frontend/src/features/upload`): CSV upload, Excel (.xlsx) upload, and a manual entry form. Each submission becomes one `staging.submission_batches` row, and every student row lands in `staging.staging_enrolment_records` as raw text, ready for the L1–L3 validation workers.

| Endpoint (`/api/v1/ingestion`) | Purpose |
|---|---|
| `POST /preview` | Parse a CSV/XLSX file and show how its columns map. Writes nothing. |
| `POST /upload` | Multipart `file`, `institutionId`, `academicYear` (e.g. `2026-27`). Returns 202 + batch. 409 if the same file was already uploaded (`allowDuplicate=true` to override). |
| `POST /form` | JSON `{ institutionId, academicYear, records: [...] }`, up to 500 students. |
| `GET /batches?institutionId=` · `GET /batches/:id` | Batch status and row counters. |
| `GET /template?format=csv\|xlsx` | Blank template with the standard column headers. |
| `GET /institutions` | Institution picker (until Keycloak auth provides the institution). |

Column headers are matched loosely (`APAAR ID`, `apaar_no`, `Student Name`, `DOB`, …). See `backend/src/modules/ingestion/columns.ts`. Unknown columns are kept in `raw_payload`. Form entry needs `database/db_scripts/ingestion_patch.sql` applied (adds the `WEB_FORM` source channel).

## Getting started

The database is hosted on Supabase; put its pooler connection string in `backend/.env` as `DATABASE_URL`.

```bash
cd backend  && cp .env.example .env && npm install
cd frontend && cp .env.example .env.local && npm install
```
