# SIH Database SDK: usage and compatibility

This guide covers the internal SDK in `database/db_connect`. The package name is `@sih/database-sdk`. It gives the backend domain-level access to the SIH PostgreSQL schemas and uses Redis only for versioned cache reads and invalidation.

## Install and configure

The SDK targets Node.js 20+ and PostgreSQL 14+. Install the package into the backend workspace, then configure these environment variables before importing the SDK:

```dotenv
DATABASE_URL=postgresql://service_role:...@<host>:<port>/<database>
UPSTASH_REDIS_REST_URL=https://<upstash-rest-endpoint>
UPSTASH_REDIS_REST_TOKEN=<secret>
NODE_ENV=production
```

Use the backend's transaction-pooling connection string. Store credentials in the deployment secret manager; never commit them. The module validates the required settings during import. Do not use an owner or migration connection for normal SDK calls.

Build from `database/db_connect` with `npm run build`. The package entry point is `dist/index.js`; declarations are in `dist/index.d.ts`.

## Basic use

Resolve the acting user ID from backend-verified authentication and pass it with a unique request ID. The SDK reloads the canonical active profile inside the transaction; a client-supplied role or institution is not authorization proof.

```ts
import {
  getInstitutionById,
  getSeatUtilisation,
  listStudentEnrolments,
} from "@sih/database-sdk";

const request = {
  actorUserId: authenticatedUser.id,
  requestId: requestIdFromMiddleware,
};

const institution = await getInstitutionById({
  ...request,
  institutionId,
});

const seatRows = await getSeatUtilisation({
  ...request,
  academicYear: "2026-27",
  page: { limit: 100, offset: 0 },
});

const enrolments = await listStudentEnrolments({
  ...request,
  studentId,
  limit: 50,
  offset: 0,
});
```

Pass only fields allowed by each function's TypeScript input type. IDs must be UUIDs; academic years use `YYYY-YY`; pages and upload sizes are bounded. Keep the request ID stable across logs for one request, and do not place PII or secrets in it.

## Available areas

- Master: institutions, affiliating bodies, programs, and intake approval reads; super-admin intake cap updates.
- Analytics: scoped reporting functions, public national summary, and admin refresh.
- Staging: batch creation/listing, bounded raw-row ingestion, safe record/anomaly summaries, status transitions, and retention purge.
- Core: scoped student/enrolment reads, status history, and promotion/finalization workflows.
- Trust: credential issue/status/read, verification, student consent, verifier organisation/member administration, and audit chain functions.

`index.ts` is the supported public API. Worker-only operations (system promotion, analytics refresh, and staging retention), connection management, generic cache operations, and transaction primitives are intentionally not re-exported. Use a dedicated worker entrypoint in the backend for system jobs; do not import internal modules from application request handlers.

## Transaction and security behavior

- Each actor call opens a transaction, sets transaction-local actor/request context, and sets the database role to `service_role`; the context is never session-scoped.
- Actor identity is resolved from `master.user_profiles` in that transaction. Domain scope is checked again before reads or writes. PostgreSQL functions and triggers remain the final authority for promotion, credential, consent, audit, and verification invariants.
- SQL values are parameterized. Dynamic SQL fragments are fixed allow-lists, not user input.
- Cache keys are environment/schema/resource/UUID or collection-generation scoped. Cache misses or Redis read/write outages fall back to the database result; post-commit invalidation failures are reported with `PostCommitCacheInvalidationError.committed === true`. Do not retry the write when that error is thrown; the database mutation already committed.
- Never log credential proofs, tokens, APAAR IDs, raw staging payloads, consent artifacts, database URLs, or Redis errors containing endpoint details.
- Credential signing and proof verification happen in the backend/KMS integration. The SDK stores a caller-provided VC document, proof and digest, and validates the digest/document relationship; it is not a signing service.

## Schema compatibility

The SDK SQL was checked against `database/db_scripts/{master,stagging,core,trust,analytics,integrate}.sql`, `database/db_schema`, and `database/db_architecture.md`.

It expects the five schemas and objects described in the architecture: master institutions/programs/intake and user profiles; staging batches, records, anomalies and PII purge; core students, enrolments and history; trust credentials/consents/verifier organisations/audit functions; and analytics reporting/refresh functions. Column names used by the repositories match the corresponding DDL, and function calls match the declared SQL signatures.

**Deployment prerequisite:** full SDK compatibility requires scripts 01–05 and `06_patch_v1_1.sql` (in this repo named `integrate.sql`) in the documented order. The architecture document says the patch was prepared from static review and had not been run against a database. The SDK relies on patch-provided objects including `core.student_accounts`, `core.enrolment_status_history`, `core.promote_program_batch` v1.1, `staging.purge_batch_identity`, actor enforcement, and the revised authorization/privilege controls. Do not enable the affected API paths until the patch has been reviewed, applied to staging, and the schema self-check has no findings.

The database scripts target PostgreSQL 14+ and Supabase conventions (`auth.users`, `service_role`, and RLS). Apply migrations as the schema owner, while runtime SDK traffic uses the constrained service connection. No migration or schema change is bundled in this SDK package.

## Current API limits

Program and institution master-data creation/edit workflows are not exposed; available writes are limited to the APIs explicitly implemented by the repositories. The SDK does not replace the backend's authentication, KMS signing, worker authorization, or deployment/migration process.
