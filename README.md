# APAAR-Based Student Data Management & Verification Platform (SIH PS26263)

Architecture: [docs/APAAR_Platform_Architecture.drawio](docs/APAAR_Platform_Architecture.drawio) · Tech stack: [docs/tech-stack.jpeg](docs/tech-stack.jpeg)

| Component | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind |
| Backend | Node.js (LTS), Express, TypeScript, REST |
| Auth | Supabase Auth (email/password), API-managed roles and scopes |
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
  src/api/            shared API client and authentication/session handling
```

## Authentication

The frontend uses the backend's Supabase email/password authentication endpoints. Configure `VITE_API_BASE_URL` in `frontend/.env.local`; it defaults to `http://localhost:4000/api/v1`.

- Sign-in calls `POST /auth/login`. The dashboard opens only after the API authenticates the user and returns an active profile.
- The frontend keeps the access and refresh tokens in tab-scoped `sessionStorage`, attaches the access token to API requests, and calls `GET /auth/me` to restore a session after reload.
- When a protected request returns `401`, the frontend calls `POST /auth/refresh` and retries the request once. Sign-out calls `POST /auth/logout` and clears the local session.
- The role management endpoints are backend-only; the frontend does not connect to `/roles` yet. Password recovery is also unavailable until a backend endpoint is added.

See [backend/AUTH_API_GUIDE.md](backend/AUTH_API_GUIDE.md) for Supabase setup, first-admin bootstrapping, request examples, and the complete auth API reference.

## Data ingestion (Stage 1)

Institutions submit enrolments three ways from the dashboard's **Data Upload** tab (`frontend/src/features/upload`): CSV upload, Excel (.xlsx) upload, and a manual entry form. Each submission becomes one `staging.submission_batches` row, and every student row lands in `staging.staging_enrolment_records` as raw text, ready for the L1–L3 validation workers.

| Endpoint (`/api/v1/ingestion`) | Purpose |
|---|---|
| `POST /preview` | Parse a CSV/XLSX file and show how its columns map. Writes nothing. |
| `POST /upload` | Multipart `file`, `institutionId`, `academicYear` (e.g. `2026-27`). Returns 202 + batch. 409 if the same file was already uploaded (`allowDuplicate=true` to override). |
| `POST /form` | JSON `{ institutionId, academicYear, records: [...] }`, up to 500 students. |
| `GET /batches?institutionId=` · `GET /batches/:id` | Batch status and row counters. |
| `GET /template?format=csv\|xlsx` | Blank template with the standard column headers. |
| `GET /institutions` | List institutions for the upload picker. |

Column headers are matched loosely (`APAAR ID`, `apaar_no`, `Student Name`, `DOB`, …). See `backend/src/modules/ingestion/columns.ts`. Unknown columns are kept in `raw_payload`. Form entry needs `database/db_scripts/ingestion_patch.sql` applied (adds the `WEB_FORM` source channel).

## Validation pipeline

Full guide (setup, checks, statuses, API, frontend, limitations, troubleshooting): [docs/ingestion-and-validation.md](docs/ingestion-and-validation.md).

Uploads are validated by a BullMQ job (`backend/src/jobs`, logic in `backend/src/modules/validation`):

| Stage | Where | Checks |
|---|---|---|
| L1 | app (`l1-rules.ts`) | required fields, APAAR format, dates, age vs program level, residency/FN/OCI flags, passport/OCI/visa/sponsorship documents, EWS seat vs category, unknown program, duplicate student / roll no. within the upload |
| L2 | app (`stages/l2.stage.ts`) | resolves each row to `core.students`: name/DOB must match an existing APAAR; new students are created (non-residents with an AES-256-GCM encrypted profile). DigiLocker/ABC lookup plugs into `integrations/apaar-registry` and is not connected yet |
| Approval | institution | nodal officer reviews the report, can run a dry-run pre-check, then approves (logged to the audit chain) |
| L3 | database (`core.promote_batch`) | intake approval / AICTE lock, seat caps per quota, quota vs residency, cut-off date, roll numbers, cross-institution national lock, then promotion |

API: `/api/v1/validation/batches/:id` (report), `/anomalies`, `/corrections.csv`, `POST /precheck`, `/approve`, `/cancel`, `/retry`. Without `REDIS_URL` jobs run inline in the API process.

## Getting started

The database is hosted on Supabase; put its pooler connection string in `backend/.env` as `DATABASE_URL`.

```bash
cd backend && cp .env.example .env && npm install
cd ../frontend && cp .env.example .env.local && npm install
```

Run the backend and frontend in separate terminals with `npm run dev` from their respective directories. Configure the backend variables in `backend/.env` and `VITE_API_BASE_URL` in `frontend/.env.local` before signing in.
