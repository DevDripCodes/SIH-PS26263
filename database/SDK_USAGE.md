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

## Security review and trust boundary

The SDK is a backend data-access layer. Its actor APIs accept `actorUserId`; that UUID is only an identifier and is **not** proof of authentication. Resolve it from a verified backend session, never from an untrusted request body. The SDK reloads the active role and scope from `master.user_profiles`, then applies object-level checks. A compromised backend process or a caller with the database `service_role` credentials can bypass these application checks, so keep those credentials private and use only the supported entry points in request handlers.

The reviewed public surface uses parameterized SQL. The dynamic SQL in analytics uses fixed function names, and staging JSON fields are selected from a fixed allow-list. The SDK does not export the pool, transaction runner, generic SQL/cache helpers, worker transition, worker promotion, PII purge, or system analytics refresh functions from `src/index.ts`.

**Fixed SDK finding:** a verifier could set their own membership back to active after an administrator disabled it, undoing that access decision. `setVerifierMembershipActive` now denies self-activation; users can deactivate their own membership, while only a super-admin can reactivate a membership. The membership table's `user_id` primary key also means a user can belong to only one verifier organisation at a time.

**Existing database boundary caveat:** the checked-in `db_scripts/core.sql` creates future `core.student_enrolments` partitions as `service_role`; `db_scripts/integrate.sql` revokes `DELETE` from partitions that exist when the patch runs, but the partition helper does not repeat that revoke for partitions created later. A partition created after that patch may retain the owner's `DELETE` privilege for direct service-role SQL. The SDK exposes no delete operation and never runs caller-provided SQL, but the database role remains privileged, so keep its credentials inside the backend and restrict runtime database access to the SDK's parameterized operations. The effective grants on the already-deployed database were not available to inspect; this is a script-derived risk, not confirmation that a vulnerable partition exists in production.

No live database was available for validating effective PostgreSQL grants, policies, or trigger behavior. Run `master.verify_security_baseline()` and `analytics.verify_analytics_security()` after applying migrations; each should return no findings. The SDK review also does not establish that API middleware authenticates the supplied actor ID or that credential proofs were cryptographically verified: those remain backend/KMS responsibilities.

## Public API reference

Unless noted otherwise, each actor input includes `actorUserId` (a UUID from backend-verified authentication) and `requestId` (non-blank string, at most 100 characters; use an opaque correlation ID, never PII). UUID inputs are case-insensitive. Paginated APIs default to `limit: 100, offset: 0`; limits and offsets are inclusive only where shown below. These are runtime constraints in addition to TypeScript types. Returned dates may be JavaScript `Date` values or strings depending on the `pg` type parser and field.

### Master data

| Function | Input values | Behavior and result |
| --- | --- | --- |
| `getInstitutionById({ actorContext, institutionId })` | `actorContext: { actorUserId, requestId }`; `institutionId: UUID` | Returns an institution summary. Super-admins, regional officers in the same region, the institution's affiliating-body registrar, and its nodal officer can read it. |
| `updateInstitutionApprovalStatus({ actorContext, institutionId, approvalStatus })` | Same context and UUID; `approvalStatus`: `EOA_GRANTED`, `NO_ADMISSION`, `WITHDRAWN`, or `SUSPENDED` | Super-admin only. Updates approval status and returns the summary. A cache invalidation error means the database change committed; do not retry blindly. |
| `getAffiliatingBodyById({ actorUserId, requestId, affiliatingBodyId })` | Body UUID | Super-admin or registrar assigned to that body; returns body identity, AISHE code, type, state, and active flag. |
| `listAffiliatingBodies({ actorUserId, requestId })` | No paging input | Super-admin gets up to 500 bodies; a registrar gets only their body. Other roles are denied. |
| `getProgramById({ actorUserId, requestId, programId })` | Program UUID | Returns program, institution, discipline, course, duration, accreditation, and active fields after scope authorization. |
| `listProgramsByInstitution({ actorUserId, requestId, institutionId, limit?, offset? })` | Institution UUID; `limit` 1–500; `offset` 0–100,000 | Returns that institution's programs ordered by course name and ID. |
| `getIntakeApprovalById({ actorUserId, requestId, intakeApprovalId })` | Intake UUID | Scoped lookup; returns the approval year, approved seat caps, lock flag, and cutoff date. |
| `getIntakeApprovalByProgramYear({ actorUserId, requestId, programId, academicYear })` | Program UUID; academic year `YYYY-YY` where the second year is the next calendar year | Returns the scoped approval or `null` when no program/approval exists. |
| `listIntakeApprovalsByInstitutionYear({ actorUserId, requestId, institutionId, academicYear, limit?, offset? })` | Institution UUID; valid academic year; `limit` 1–500; `offset` 0–100,000 | Lists approvals for one institution and year. |
| `updateIntakeApprovalCaps({ actorUserId, requestId, intakeApprovalId, caps, lockedByAicte? })` | `caps` has non-negative integer `approvedSanctionedIntake`, `approvedNriSeats`, `approvedTfwSeats`, `approvedFnOciCiwgcSeats`, `approvedPmsssSeats`, `approvedEwsSeats`, `approvedLateralEntrySeats`; optional boolean lock | Super-admin only; updates caps and returns the approval. Database policy/trigger controls remain required for cap invariants. |

### Analytics

All scoped analytics functions take `{ actorUserId, requestId, ...filters }`; the database function applies the actor's institution, body, region, or admin scope. `page` is `{ limit?: 1..500, offset?: 0..100000 }` and defaults to `{ limit: 100, offset: 0 }`.

| Function | Additional input values | Result |
| --- | --- | --- |
| `getSeatUtilisation` | `academicYear`; optional `institutionId` UUID, `onlyFlagged` boolean, and `page` | Seat caps versus enrolments, fill percentage, and over-cap/policy flags. |
| `getEnrolmentSummary` | `academicYear`; optional `institutionId`, `page` | Counts grouped by institution, program, quota, residency, and status. |
| `getPipelineDaily` | `from`, `to` as real `YYYY-MM-DD` dates, ordered and no more than 366 days apart; optional `institutionId`, `page` | Daily batch, validation, promotion, and processing counts. |
| `getAnomalySummary` | `academicYear`; optional `institutionId`, `onlyUnresolved` boolean, `page` | Aggregated anomaly counts and affected rows. |
| `getCredentialStatus` | `academicYear`; optional `institutionId`, `page` | Credential counts grouped by institution, year, type, and status. |
| `getVerificationDaily` | `from`, `to` dates with the same 366-day maximum; `page` | National daily verification aggregates. |
| `getQuotaReconciliation` | `academicYear`; optional `onlyDrift` boolean (defaults true), `page` | Intake-counter drift by quota; restricted to AICTE officers by the database function. |
| `getAnalyticsFreshness` | Actor context only | Freshness and age for analytics views. |
| `getPublicNationalSummary(academicYear)` | Valid `YYYY-YY` | Public coarse-grained national counts; small cells are hidden by the database function. This is the only analytics read without actor context. |
| `refreshAnalyticsAsAdmin(actorUserId, requestId, force?)` | `force` boolean, defaults false | Super-admin only; returns refresh status and per-view results. A refresh invalidation error is post-commit. |

### Staging and batch intake

| Function | Input values | Behavior and result |
| --- | --- | --- |
| `createSubmissionBatch` | Actor context; `institutionId` UUID; valid `academicYear`; `sourceChannel`: `CSV_UPLOAD`, `EXCEL_UPLOAD`, `ERP_API`; `fileSha256`: 64 hex characters; optional non-negative safe integer `fileSizeBytes` | Super-admin or nodal officer for that institution. Returns `{ batch, duplicate }`; duplicate file digests for the same institution return the existing batch. |
| `getSubmissionBatch` | Actor context; `batchId` UUID | Returns one batch summary only when the actor can read its institution. |
| `listSubmissionBatches` | Actor context; `institutionId`; optional valid `academicYear`, `limit` 1–500, `offset` 0–100,000 | Lists scoped batches newest first. |
| `ingestStagingRecords` | Actor context; `batchId`; `rows` has 1–500 entries, each with a unique positive safe `sourceRowNumber` and optional string/null fields `raw_apaar_id`, `raw_full_name`, `raw_date_of_birth`, `raw_gender`, `raw_email`, `raw_mobile`, `raw_roll_no`, `raw_program_code`, `raw_admission_date`, `raw_social_category`, `raw_residency_status`, `raw_seat_quota_type`, `raw_is_fn`, `raw_is_oci_status`, `raw_nationality`, `raw_passport_no`, `raw_passport_expiry`, `raw_visa_type`, `raw_frro_reg_no`, `raw_oci_card_no`, `raw_embassy_sponsor_ref` | Super-admin or batch institution's nodal officer; batch must be `UPLOADED`. Each field is at most 10,000 characters; serialized payload at most 1 MB. Returns inserted row count. The input contains raw PII: do not log it. |
| `listStagingRecordSummaries` | Actor context; `batchId`; `limit` 1–500, `offset` 0–100,000 | Returns safe row status summaries, not raw payload columns. |
| `listStagingAnomalies` | Same paging inputs | Returns anomaly code/severity/level and field name for the authorized batch. |
| `getStagingStatusSummary` | Actor context; `batchId` | Returns counts grouped by validation status. |
| `promoteBatch(actorUserId, requestId, batchId)` | UUIDs and opaque request ID | Super-admin or owning institution nodal officer; invokes the database promotion function and returns batch/program promotion counts. |
| `promoteProgramBatch(actorUserId, requestId, batchId, programId)` | Same plus program UUID | Same authorization; promotes only the selected program in the batch and returns its counts. |
| `finalizeBatch(actorUserId, requestId, batchId)` | UUIDs and opaque request ID | Same authorization; asks the database function to finalize and returns the status string. |

### Core enrolment reads

| Function | Input values | Behavior and result |
| --- | --- | --- |
| `getStudentById({ actorUserId, requestId, studentId })` | Student UUID | Student can read their own record; institutional, body, regional, and admin scope can read eligible enrolment-linked students. Returns name, gender, residency, and APAAR verification status. |
| `listStudentEnrolments({ actorUserId, requestId, studentId, limit?, offset? })` | Student UUID; `limit` 1–500; `offset` 0–100,000 | Returns scoped enrolments newest academic year first. |
| `getEnrolment({ actorUserId, requestId, enrolmentId, academicYear })` | Enrolment UUID and valid `YYYY-YY` | Returns one enrolment in the actor's scope or denies access. |
| `listEnrolmentStatusHistory({ actorUserId, requestId, enrolmentId, academicYear, limit?, offset? })` | Same ID/year and page bounds | Returns the status-change history for an enrolment the actor can read. |

### Credentials, verification, consent, and audit

| Function | Input values | Behavior and result |
| --- | --- | --- |
| `issueCredential` | Actor context; `enrolmentId` UUID; `academicYear`; `credentialType`: `DEGREE_CERTIFICATE`, `DIPLOMA_CERTIFICATE`, `PROVISIONAL_CERTIFICATE`, `SEMESTER_MARKSHEET`, `ENROLMENT_PROOF`, `TRANSFER_CERTIFICATE`; optional `periodLabel` matching `[A-Z0-9_-]{1,40}` (default `FINAL`); `issuerDid`; `verificationMethod` 8–500 chars; `proofType` 1–60 chars; `proofValue` 16–20,000 chars; JSON `vcDocument` with `@context`, `type`, `issuer`, `credentialSubject`; 32-byte `credentialHash`; optional paired `statusListId` (1–100 chars) and non-negative integer `statusListIndex`; optional parseable `validFrom`, `validUntil`; optional superseded credential UUID | Nodal officer or registrar scoped to the institution. SDK canonicalizes JSON and checks SHA-256 matches the supplied document. It does not prove the issuer controls the DID or cryptographically validate `proofValue`; do that in the backend/KMS flow before calling. Returns credential summary. |
| `getCredentialById` | Actor context; credential UUID | Student owner or scoped master-data actor can read the summary; employer verifiers are denied here and must use the verification workflow. |
| `updateCredentialStatus` | Actor context; credential UUID; status `ISSUED`, `SUSPENDED`, or `REVOKED`; reason `ADMINISTRATIVE_REVIEW`, `COMPLIANCE_REVIEW`, `DATA_CORRECTION`, or `SUSPECTED_FRAUD` | Nodal officer or registrar for the credential's institution; invokes the database status function. Returns void. |
| `verifyCredential` | Actor context; verifier organisation and credential UUIDs; purpose `EMPLOYMENT_VERIFICATION`, `HIGHER_EDUCATION_ADMISSION`, `SCHOLARSHIP_ELIGIBILITY`, `GOVERNMENT_SCHEME_BENEFIT`, or `DIGILOCKER_ISSUANCE`; 12-digit `presentedApaarId`; non-blank `presentedRollId` up to 50 chars; optional 32-byte `clientFingerprint` | Employer-verifier role only. Database function checks org membership, consent, identifiers, and rate limits; result is one of `VERIFIED`, `CONSENT_REQUIRED`, `RATE_LIMITED`, `NOT_AUTHORISED`, `NOT_VALID`, `NOT_VERIFIED`. Avoid logging presented identifiers. |
| `createConsent` | Actor context; `granteeOrgId` UUID; purpose from verification purposes; exactly one of `scopeCredentialId` UUID or `scopeAllCredentials: true`; unique `disclosureScope` entries from `CREDENTIAL_VALIDITY`, `PROGRAM_DETAILS`, `GRADES`, `ENROLMENT_STATUS` (1–4); `consentTextVersion` matching `[A-Za-z0-9._-]{1,30}`; `grantChannel`: `DIGILOCKER`, `STUDENT_APP`, `OTP_ESIGN`; 32-byte `consentArtifactHash`; optional `guardianConsent` and 32-byte `guardianArtifactHash`; parseable `expiresAt` | Student role only and tied to the student's own account. The hash is a reference/integrity value, not proof that consent was validly captured; backend must verify the consent ceremony. Returns consent summary. |
| `listMyConsents` | Actor context; optional `limit` 1–200, `offset` 0–10,000 | Student role only; lists the actor's consents. |
| `withdrawMyConsent` | Actor context; `consentId` UUID; channel from `DIGILOCKER`, `STUDENT_APP`, `OTP_ESIGN` | Student role only; invokes the database withdrawal function. Returns void. |
| `registerVerifierOrganisation` | Actor context; `orgType`: `EMPLOYER`, `BGV_AGENCY`, `EDUCATIONAL_INSTITUTION`, `GOVERNMENT_AGENCY`, `DIGILOCKER_PLATFORM`; `legalName` 1–300 chars; `registrationType`: `CIN`, `LLPIN`, `GSTIN`, `PAN`, `AICTE_ID`, `OTHER`; non-blank `registrationNo` up to 50 chars; email up to 255 chars | Employer-verifier role only; creates a pending organisation and the caller's initial membership. |
| `getVerifierOrganisation` | Actor context; `verifierOrgId` UUID | Super-admin or active member of that organisation; returns public organisation summary. |
| `listMyVerifierOrganisations` | Actor context; optional `limit` 1–200, `offset` 0–10,000 | Employer-verifier role; returns active memberships. |
| `reviewVerifierOrganisation` | Actor context; `verifierOrgId`; status `APPROVED`, `SUSPENDED`, or `REVOKED` | Super-admin only; records the decision and returns summary. |
| `addVerifierOrganisationMember` | Actor context; `userId`, `verifierOrgId` UUIDs | Super-admin only; target must be an active `EMPLOYER_VERIFIER` profile. |
| `setMyVerifierMembershipActive` | Actor context; boolean `active` | Employer verifier can deactivate their own membership (`active: false`). Reactivation is super-admin only. |
| `setVerifierMembershipActive` | Actor context; `userId` UUID; boolean `active` | Super-admin can activate or deactivate the selected user's membership; employer verifier can only deactivate themselves. |
| `logApplicationAuditEvent` | Actor context; event `BATCH_CREATED`, `BATCH_PROMOTED`, `CREDENTIAL_ISSUED`, `CONSENT_WITHDRAWN`, or `VERIFIER_ORG_REVIEWED`; `subjectId` UUID; optional `institutionId` UUID (required for batch and credential events); outcome `SUCCESS`, `DENIED`, or `FAILED` | Writes a fixed-shape application audit record after role and scope checks. Call only from trusted backend flows and pass the real outcome; never include PII in IDs or request IDs. |
| `verifyAuditChain` | Actor context; `chainKey`: `credentials`, `consents`, `verifier_orgs`, `verification`, `app_core`, `app_master`, or `app_trust`; optional safe integer `fromSequence` (default 1), `toSequence` (default `from + 99,999`), both >=1, `to >= from`, range at most 100,000 | Super-admin only; returns `ok`, rows checked, first bad sequence, and reason. |

### Error and retry handling

Validation failures throw `TypeError` or `RangeError`; denied or out-of-scope access generally throws `AuthorizationError`. Database errors propagate. `PostCommitCacheInvalidationError` has `committed === true`: the database mutation already succeeded, so do not repeat the operation without first checking its state. `verifyCredential` also records the verification attempt even when its business result is `RATE_LIMITED` or another non-success result.
