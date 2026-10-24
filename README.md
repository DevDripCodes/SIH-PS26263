# APAAR-Based Student Data Management & Verification Platform (SIH PS26263)

Architecture: [docs/APAAR_Platform_Architecture.drawio](docs/APAAR_Platform_Architecture.drawio) · Tech stack: [docs/tech-stack.jpeg](docs/tech-stack.jpeg)

| Component | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind |
| Backend | Node.js (LTS), Express, TypeScript, REST |
| Auth | Keycloak (OIDC/MFA), OAuth2, RBAC |
| Database | PostgreSQL (Prisma) |
| Background jobs | BullMQ, Redis |
| Files & integrations | S3-compatible storage (MinIO), REST adapters |
| Security | AES-256 field encryption, masked APAAR IDs, signed QR verification |
| Deployment & monitoring | Docker, OpenTelemetry |

## Layout

```
backend/
  prisma/             schema + migrations (Institution, Program, Student, Enrolment, Consent, ...)
  src/modules/        ingestion, validation, workflow (maker-checker), anomaly, consent,
                      verification, reports, notifications, audit, auth, core entities
  src/integrations/   APAAR registry, DigiLocker, AICTE approval, NSP, AISHE, degree bodies
  src/jobs/           BullMQ queues + processors
  src/lib/            crypto, storage (S3), ledger (Merkle anchoring), telemetry
frontend/
  src/pages/          institution, approver, aicte-admin, regional, verifier, student, public
  src/features/       upload, validation, approvals, dashboards, consent, verification, reports
infra/                keycloak realm, postgres init, otel config
```

## Getting started

```bash
docker compose up -d                         # postgres, redis, keycloak, minio, otel
cd backend  && cp .env.example .env && npm install
cd frontend && cp .env.example .env.local && npm install
```
