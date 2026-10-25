import { createHash } from "node:crypto";
import { resolveActorContext } from "./actor-context";
import { AuthorizationError, authorizeMasterAccess } from "./authorization";
import { withActorTx } from "./pool";
import { assertStudentReadable } from "./core-access";
import { invalidateCredentialChanges, PostCommitCacheInvalidationError } from "./cache-invalidation-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface CredentialActor { actorUserId: string; requestId: string }
export interface CredentialSummary { credentialId: string; academicYear: string; institutionId: string; programId: string; credentialType: string; periodLabel: string; status: string; validFrom: Date | string; validUntil: Date | string | null; issuedAt: Date | string }
interface Row extends Record<string, unknown>, CredentialSummary { studentId: string; affiliatingBodyId: string | null; aicteRegion: string }
const CREDENTIAL_TYPES = new Set(["DEGREE_CERTIFICATE", "DIPLOMA_CERTIFICATE", "PROVISIONAL_CERTIFICATE", "SEMESTER_MARKSHEET", "ENROLMENT_PROOF", "TRANSFER_CERTIFICATE"]);
const STATUSES = new Set(["ISSUED", "SUSPENDED", "REVOKED"]);
const REASONS = new Set(["ADMINISTRATIVE_REVIEW", "COMPLIANCE_REVIEW", "DATA_CORRECTION", "SUSPECTED_FRAUD"]);
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(",")}}`;
}

function validateJson(value: unknown, depth = 0): asserts value is Json {
  if (depth > 32) throw new RangeError("Credential document is too deeply nested.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) validateJson(item, depth + 1); return; }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const item of Object.values(value)) validateJson(item, depth + 1);
    return;
  }
  throw new TypeError("Credential document must contain only JSON values.");
}

export interface IssueCredentialInput extends CredentialActor {
  enrolmentId: string;
  academicYear: string;
  credentialType: string;
  periodLabel?: string;
  issuerDid: string;
  verificationMethod: string;
  proofType: string;
  proofValue: string;
  vcDocument: unknown;
  credentialHash: Buffer;
  statusListId?: string;
  statusListIndex?: number;
  validFrom?: string;
  validUntil?: string | null;
  supersedesCredentialId?: string;
}

export interface UpdateCredentialStatusInput extends CredentialActor { credentialId: string; status: "ISSUED" | "SUSPENDED" | "REVOKED"; reason: "ADMINISTRATIVE_REVIEW" | "COMPLIANCE_REVIEW" | "DATA_CORRECTION" | "SUSPECTED_FRAUD" }

function validateActor(input: CredentialActor): void {
  if (!input || !UUID.test(input.actorUserId) || typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100) throw new TypeError("Valid authenticated actor context is required.");
}

export async function issueCredential(input: IssueCredentialInput): Promise<CredentialSummary> {
  validateActor(input);
  if (!UUID.test(input.enrolmentId) || !/^\d{4}-\d{2}$/.test(input.academicYear) || Number(input.academicYear.slice(5)) !== (Number(input.academicYear.slice(0, 4)) + 1) % 100 || !CREDENTIAL_TYPES.has(input.credentialType) || !/^[A-Z0-9_-]{1,40}$/.test(input.periodLabel ?? "FINAL") || !/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/.test(input.issuerDid) || typeof input.verificationMethod !== "string" || input.verificationMethod.length < 8 || input.verificationMethod.length > 500 || typeof input.proofType !== "string" || input.proofType.length < 1 || input.proofType.length > 60 || typeof input.proofValue !== "string" || input.proofValue.length < 16 || input.proofValue.length > 20_000 || !Buffer.isBuffer(input.credentialHash) || input.credentialHash.length !== 32 || (input.statusListId !== undefined && (typeof input.statusListId !== "string" || input.statusListId.length < 1 || input.statusListId.length > 100)) || (input.statusListIndex !== undefined && (!Number.isInteger(input.statusListIndex) || input.statusListIndex < 0)) || ((input.statusListId === undefined) !== (input.statusListIndex === undefined)) || (input.validFrom !== undefined && (typeof input.validFrom !== "string" || Number.isNaN(Date.parse(input.validFrom)))) || (input.validUntil !== undefined && input.validUntil !== null && (typeof input.validUntil !== "string" || Number.isNaN(Date.parse(input.validUntil)))) || (input.supersedesCredentialId !== undefined && !UUID.test(input.supersedesCredentialId))) throw new TypeError("Invalid credential issuance input.");
  validateJson(input.vcDocument);
  const document = input.vcDocument as Json;
  if (!document || Array.isArray(document) || typeof document !== "object" || !["@context", "type", "issuer", "credentialSubject"].every(key => Object.hasOwn(document, key))) throw new TypeError("Credential document is missing required fields.");
  const canonical = canonicalJson(document);
  if (Buffer.byteLength(canonical, "utf8") > 262_144 || !createHash("sha256").update(canonical, "utf8").digest().equals(input.credentialHash)) throw new TypeError("Credential hash does not match its canonical document.");
  const result = await withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    if (!(actor.role === "INSTITUTION_NODAL_OFFICER" || actor.role === "AFFILIATING_BODY_REGISTRAR")) throw new AuthorizationError("FORBIDDEN");
    const enrolment = await tx.query<{ studentId: string; institutionId: string; programId: string; affiliatingBodyId: string | null; aicteRegion: string }>(`SELECT e.student_id::text AS "studentId", e.institution_id::text AS "institutionId", e.program_id::text AS "programId", i.affiliating_body_id::text AS "affiliatingBodyId", i.aicte_region AS "aicteRegion" FROM core.student_enrolments e JOIN master.institutions i ON i.institution_id = e.institution_id WHERE e.enrolment_id = $1::uuid AND e.academic_year = $2 FOR SHARE OF e, i`, [input.enrolmentId.toLowerCase(), input.academicYear]);
    const row = enrolment.rows[0]; if (!row) throw new AuthorizationError("FORBIDDEN");
    authorizeMasterAccess(actor, "master.institution.read", { institutionId: row.institutionId, affiliatingBodyId: row.affiliatingBodyId, aicteRegion: row.aicteRegion });
    await tx.query("SELECT trust.assert_institution_actor($1::uuid, $2::uuid, 'issue credential')", [actor.userId.toLowerCase(), row.institutionId]);
    const inserted = await tx.query<CredentialSummary & Record<string, unknown>>(`INSERT INTO trust.academic_credentials (student_id, enrolment_id, academic_year, institution_id, program_id, credential_type, period_label, issuer_did, verification_method, proof_type, proof_value, vc_document, credential_hash, status_list_id, status_list_index, valid_from, valid_until, supersedes_credential_id, issued_by) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::trust.credential_type_enum, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, COALESCE($16::timestamptz, now()), $17::timestamptz, $18::uuid, $19::uuid) RETURNING credential_id::text AS "credentialId", academic_year AS "academicYear", institution_id::text AS "institutionId", program_id::text AS "programId", credential_type::text AS "credentialType", period_label AS "periodLabel", status::text AS status, valid_from AS "validFrom", valid_until AS "validUntil", issued_at AS "issuedAt"`, [row.studentId, input.enrolmentId.toLowerCase(), input.academicYear, row.institutionId, row.programId, input.credentialType, input.periodLabel ?? "FINAL", input.issuerDid, input.verificationMethod, input.proofType, input.proofValue, canonical, input.credentialHash, input.statusListId ?? null, input.statusListIndex ?? null, input.validFrom ?? null, input.validUntil ?? null, input.supersedesCredentialId?.toLowerCase() ?? null, actor.userId.toLowerCase()]);
    if (!inserted.rows[0]) throw new Error("Credential issuance returned no result.");
    return inserted.rows[0];
  });
  try { await invalidateCredentialChanges(result.credentialId, ...(input.supersedesCredentialId ? [input.supersedesCredentialId.toLowerCase()] : [])); }
  catch (cause) { throw new PostCommitCacheInvalidationError("Credential was issued, but cache invalidation failed; do not retry issuance.", cause); }
  return result;
}

export async function updateCredentialStatus(input: UpdateCredentialStatusInput): Promise<void> {
  validateActor(input);
  if (!UUID.test(input.credentialId) || !STATUSES.has(input.status) || !REASONS.has(input.reason)) throw new TypeError("Invalid credential status request.");
  const changed = await withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    if (!(actor.role === "INSTITUTION_NODAL_OFFICER" || actor.role === "AFFILIATING_BODY_REGISTRAR")) throw new AuthorizationError("FORBIDDEN");
    const credential = await tx.query<{ institutionId: string; affiliatingBodyId: string | null; aicteRegion: string; status: string }>("SELECT c.institution_id::text AS \"institutionId\", i.affiliating_body_id::text AS \"affiliatingBodyId\", i.aicte_region AS \"aicteRegion\", c.status::text AS status FROM trust.academic_credentials c JOIN master.institutions i ON i.institution_id = c.institution_id WHERE c.credential_id = $1::uuid FOR UPDATE OF c FOR SHARE OF i", [input.credentialId.toLowerCase()]);
    if (!credential.rows[0]) throw new AuthorizationError("FORBIDDEN");
    authorizeMasterAccess(actor, "master.institution.read", { institutionId: credential.rows[0].institutionId, affiliatingBodyId: credential.rows[0].affiliatingBodyId, aicteRegion: credential.rows[0].aicteRegion });
    await tx.query("SELECT trust.assert_institution_actor($1::uuid, $2::uuid, 'change credential status')", [actor.userId.toLowerCase(), credential.rows[0].institutionId]);
    if (credential.rows[0].status === input.status) return false;
    await tx.query("SELECT trust.set_credential_status($1::uuid, $2::trust.credential_status_enum, $3::uuid, $4)", [input.credentialId.toLowerCase(), input.status, actor.userId.toLowerCase(), input.reason]);
    return true;
  });
  if (changed) {
    try { await invalidateCredentialChanges(input.credentialId.toLowerCase()); }
    catch (cause) { throw new PostCommitCacheInvalidationError("Credential status was committed, but cache invalidation failed; do not retry the status change.", cause); }
  }
}

export async function getCredentialById(input: CredentialActor & { credentialId: string }): Promise<CredentialSummary> {
  if (!input || !UUID.test(input.actorUserId) || !UUID.test(input.credentialId) || typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100) throw new TypeError("Invalid credential lookup input.");
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    if (actor.role === "EMPLOYER_VERIFIER") throw new AuthorizationError("FORBIDDEN");
    const result = await tx.query<Row>(`SELECT c.credential_id::text AS "credentialId", c.student_id::text AS "studentId", c.academic_year AS "academicYear", c.institution_id::text AS "institutionId", c.program_id::text AS "programId", c.credential_type::text AS "credentialType", c.period_label AS "periodLabel", c.status::text AS status, c.valid_from AS "validFrom", c.valid_until AS "validUntil", c.issued_at AS "issuedAt", i.affiliating_body_id::text AS "affiliatingBodyId", i.aicte_region AS "aicteRegion" FROM trust.academic_credentials c JOIN master.institutions i ON i.institution_id = c.institution_id WHERE c.credential_id = $1::uuid`, [input.credentialId.toLowerCase()]);
    const row = result.rows[0]; if (!row) throw new AuthorizationError("FORBIDDEN");
    if (actor.role === "STUDENT") await assertStudentReadable(tx, actor, row.studentId);
    else authorizeMasterAccess(actor, "master.institution.read", { institutionId: row.institutionId, affiliatingBodyId: row.affiliatingBodyId, aicteRegion: row.aicteRegion });
    return { credentialId: row.credentialId, academicYear: row.academicYear, institutionId: row.institutionId, programId: row.programId, credentialType: row.credentialType, periodLabel: row.periodLabel, status: row.status, validFrom: row.validFrom, validUntil: row.validUntil, issuedAt: row.issuedAt };
  });
}
