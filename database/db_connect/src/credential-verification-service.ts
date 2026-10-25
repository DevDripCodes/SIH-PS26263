import { resolveActorContext } from "./actor-context";
import { AuthorizationError } from "./authorization";
import { withActorTx } from "./pool";
import { invalidateForMutation, PostCommitCacheInvalidationError } from "./cache-invalidation-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type VerificationPurpose = "EMPLOYMENT_VERIFICATION" | "HIGHER_EDUCATION_ADMISSION" | "SCHOLARSHIP_ELIGIBILITY" | "GOVERNMENT_SCHEME_BENEFIT" | "DIGILOCKER_ISSUANCE";
export type PublicVerificationResult = "VERIFIED" | "CONSENT_REQUIRED" | "RATE_LIMITED" | "NOT_AUTHORISED" | "NOT_VALID" | "NOT_VERIFIED";
export interface CredentialVerificationResult { result: PublicVerificationResult; verification_id: string; credential_type?: string; issued_at?: string; institution_id?: string; disclosure_scope?: string[] }
export interface VerifyCredentialInput { actorUserId: string; requestId: string; verifierOrgId: string; credentialId: string; purpose: VerificationPurpose; presentedApaarId: string; presentedRollId: string; clientFingerprint?: Buffer }
const PURPOSES: ReadonlySet<string> = new Set(["EMPLOYMENT_VERIFICATION", "HIGHER_EDUCATION_ADMISSION", "SCHOLARSHIP_ELIGIBILITY", "GOVERNMENT_SCHEME_BENEFIT", "DIGILOCKER_ISSUANCE"]);
const PUBLIC_RESULTS: ReadonlySet<string> = new Set(["VERIFIED", "CONSENT_REQUIRED", "RATE_LIMITED", "NOT_AUTHORISED", "NOT_VALID", "NOT_VERIFIED"]);

export async function verifyCredential(input: VerifyCredentialInput): Promise<CredentialVerificationResult> {
  if (!input || !UUID.test(input.actorUserId) || !UUID.test(input.verifierOrgId) || !UUID.test(input.credentialId) || typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100 || !PURPOSES.has(input.purpose) || typeof input.presentedApaarId !== "string" || !/^\d{12}$/.test(input.presentedApaarId) || typeof input.presentedRollId !== "string" || input.presentedRollId.trim().length === 0 || input.presentedRollId.length > 50 || (input.clientFingerprint !== undefined && (!Buffer.isBuffer(input.clientFingerprint) || input.clientFingerprint.length !== 32))) throw new TypeError("Invalid credential verification input.");
  const value = await withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    if (actor.role !== "EMPLOYER_VERIFIER") throw new AuthorizationError("FORBIDDEN");
    const result = await tx.query<{ result: CredentialVerificationResult }>("SELECT trust.verify_credential($1::uuid, $2::uuid, $3::uuid, $4::trust.consent_purpose_enum, $5, $6, $7) AS result", [input.credentialId.toLowerCase(), input.verifierOrgId.toLowerCase(), actor.userId.toLowerCase(), input.purpose, input.presentedApaarId, input.presentedRollId, input.clientFingerprint ?? null]);
    const value = result.rows[0]?.result;
    if (!value || !PUBLIC_RESULTS.has(value.result) || !UUID.test(value.verification_id)) throw new Error("Credential verification returned an invalid public result.");
    return value;
  });
  try { await invalidateForMutation("verification", input.verifierOrgId); }
  catch (cause) { throw new PostCommitCacheInvalidationError("Verification was recorded, but analytics cache invalidation failed; do not retry verification.", cause); }
  return value;
}
