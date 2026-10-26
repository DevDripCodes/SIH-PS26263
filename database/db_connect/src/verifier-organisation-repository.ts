import { resolveActorContext } from "./actor-context";
import { AuthorizationError } from "./authorization";
import { withActorTx } from "./pool";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface VerifierOrganisationSummary { verifierOrgId: string; orgType: string; legalName: string; status: string }
interface OrgRow extends Record<string, unknown> { verifierOrgId: string; orgType: string; legalName: string; status: string }
export interface VerifierActor { actorUserId: string; requestId: string }
export type VerifierOrganisationType = "EMPLOYER" | "BGV_AGENCY" | "EDUCATIONAL_INSTITUTION" | "GOVERNMENT_AGENCY" | "DIGILOCKER_PLATFORM";
export type VerifierRegistrationType = "CIN" | "LLPIN" | "GSTIN" | "PAN" | "AICTE_ID" | "OTHER";
function context(input: VerifierActor): void { if (!input || !UUID.test(input.actorUserId) || typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100) throw new TypeError("Valid authenticated actor context is required."); }
function map(row: OrgRow): VerifierOrganisationSummary { return { verifierOrgId: row.verifierOrgId, orgType: row.orgType, legalName: row.legalName, status: row.status }; }

export async function registerVerifierOrganisation(input: VerifierActor & { orgType: VerifierOrganisationType; legalName: string; registrationType: VerifierRegistrationType; registrationNo: string; contactEmail: string }): Promise<VerifierOrganisationSummary> {
  context(input);
  if (!["EMPLOYER", "BGV_AGENCY", "EDUCATIONAL_INSTITUTION", "GOVERNMENT_AGENCY", "DIGILOCKER_PLATFORM"].includes(input.orgType) || !["CIN", "LLPIN", "GSTIN", "PAN", "AICTE_ID", "OTHER"].includes(input.registrationType) || typeof input.legalName !== "string" || !input.legalName.trim() || input.legalName.length > 300 || typeof input.registrationNo !== "string" || !input.registrationNo.trim() || input.registrationNo.trim().length > 50 || typeof input.contactEmail !== "string" || input.contactEmail.length > 255 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.contactEmail)) throw new TypeError("Invalid verifier organisation registration.");
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    if (actor.role !== "EMPLOYER_VERIFIER") throw new AuthorizationError("FORBIDDEN");
    const inserted = await tx.query<OrgRow>(`INSERT INTO trust.verifier_organisations (org_type, legal_name, registration_type, registration_no, contact_email) VALUES ($1::trust.verifier_org_type_enum, $2, $3, $4, $5) RETURNING verifier_org_id::text AS "verifierOrgId", org_type::text AS "orgType", legal_name AS "legalName", status::text AS status`, [input.orgType, input.legalName.trim(), input.registrationType, input.registrationNo.trim().toUpperCase(), input.contactEmail.trim()]);
    const org = inserted.rows[0]; if (!org) throw new Error("Verifier organisation registration returned no result.");
    await tx.query("INSERT INTO trust.verifier_org_members (user_id, verifier_org_id, is_active) VALUES ($1::uuid, $2::uuid, TRUE)", [actor.userId.toLowerCase(), org.verifierOrgId]);
    return map(org);
  });
}

export async function getVerifierOrganisation(input: VerifierActor & { verifierOrgId: string }): Promise<VerifierOrganisationSummary> {
  context(input); if (!UUID.test(input.verifierOrgId)) throw new TypeError("Verifier organisation ID must be a UUID.");
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    if (actor.role !== "AICTE_SUPER_ADMIN" && actor.role !== "EMPLOYER_VERIFIER") throw new AuthorizationError("FORBIDDEN");
    const result = await tx.query<OrgRow>(`SELECT o.verifier_org_id::text AS "verifierOrgId", o.org_type::text AS "orgType", o.legal_name AS "legalName", o.status::text AS status FROM trust.verifier_organisations o WHERE o.verifier_org_id = $1::uuid AND ($2::boolean OR EXISTS (SELECT 1 FROM trust.verifier_org_members m WHERE m.verifier_org_id = o.verifier_org_id AND m.user_id = $3::uuid AND m.is_active))`, [input.verifierOrgId.toLowerCase(), actor.role === "AICTE_SUPER_ADMIN", actor.userId.toLowerCase()]);
    if (!result.rows[0]) throw new AuthorizationError("FORBIDDEN");
    return map(result.rows[0]);
  });
}

export async function listMyVerifierOrganisations(input: VerifierActor & { limit?: number; offset?: number }): Promise<VerifierOrganisationSummary[]> {
  context(input); const limit = input.limit ?? 100, offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 10_000) throw new RangeError("Invalid verifier organisation page bounds.");
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    if (actor.role !== "EMPLOYER_VERIFIER") throw new AuthorizationError("FORBIDDEN");
    const result = await tx.query<OrgRow>(`SELECT o.verifier_org_id::text AS "verifierOrgId", o.org_type::text AS "orgType", o.legal_name AS "legalName", o.status::text AS status FROM trust.verifier_organisations o JOIN trust.verifier_org_members m ON m.verifier_org_id = o.verifier_org_id WHERE m.user_id = $1::uuid AND m.is_active ORDER BY o.legal_name, o.verifier_org_id LIMIT $2 OFFSET $3`, [actor.userId.toLowerCase(), limit, offset]);
    return result.rows.map(map);
  });
}

export async function reviewVerifierOrganisation(input: VerifierActor & { verifierOrgId: string; status: "APPROVED" | "SUSPENDED" | "REVOKED" }): Promise<VerifierOrganisationSummary> {
  context(input); if (!UUID.test(input.verifierOrgId) || !["APPROVED", "SUSPENDED", "REVOKED"].includes(input.status)) throw new TypeError("Invalid verifier review input.");
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    if (actor.role !== "AICTE_SUPER_ADMIN") throw new AuthorizationError("FORBIDDEN");
    const current = await tx.query<OrgRow>(`SELECT o.verifier_org_id::text AS "verifierOrgId", o.org_type::text AS "orgType", o.legal_name AS "legalName", o.status::text AS status FROM trust.verifier_organisations o WHERE o.verifier_org_id = $1::uuid FOR UPDATE`, [input.verifierOrgId.toLowerCase()]);
    if (!current.rows[0]) throw new AuthorizationError("FORBIDDEN");
    if (current.rows[0].status === input.status) return map(current.rows[0]);
    const result = await tx.query<OrgRow>(`UPDATE trust.verifier_organisations AS o SET status = $2::trust.verifier_org_status_enum, decided_by = $3::uuid WHERE o.verifier_org_id = $1::uuid RETURNING o.verifier_org_id::text AS "verifierOrgId", o.org_type::text AS "orgType", o.legal_name AS "legalName", o.status::text AS status`, [input.verifierOrgId.toLowerCase(), input.status, actor.userId.toLowerCase()]);
    if (!result.rows[0]) throw new AuthorizationError("FORBIDDEN");
    return map(result.rows[0]);
  });
}

export async function addVerifierOrganisationMember(input: VerifierActor & { userId: string; verifierOrgId: string }): Promise<void> {
  context(input); if (!UUID.test(input.userId) || !UUID.test(input.verifierOrgId)) throw new TypeError("Verifier user and organisation IDs must be UUIDs.");
  await withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    if (actor.role !== "AICTE_SUPER_ADMIN") throw new AuthorizationError("FORBIDDEN");
    const target = await tx.query<{ role: string; isActive: boolean }>("SELECT role::text AS role, is_active AS \"isActive\" FROM master.user_profiles WHERE user_id = $1::uuid FOR SHARE", [input.userId.toLowerCase()]);
    if (target.rows[0]?.role !== "EMPLOYER_VERIFIER" || target.rows[0].isActive !== true) throw new AuthorizationError("FORBIDDEN");
    await tx.query("INSERT INTO trust.verifier_org_members (user_id, verifier_org_id, is_active) VALUES ($1::uuid, $2::uuid, TRUE)", [input.userId.toLowerCase(), input.verifierOrgId.toLowerCase()]);
  });
}

export async function setMyVerifierMembershipActive(input: VerifierActor & { active: boolean }): Promise<void> {
  await setVerifierMembershipActive({ ...input, userId: input.actorUserId });
}

export async function setVerifierMembershipActive(input: VerifierActor & { userId: string; active: boolean }): Promise<void> {
  context(input); if (!UUID.test(input.userId) || typeof input.active !== "boolean") throw new TypeError("Invalid verifier membership update.");
  await withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    const targetUserId = input.userId.toLowerCase();
    const self = targetUserId === actor.userId.toLowerCase();
    if (!self && actor.role !== "AICTE_SUPER_ADMIN") throw new AuthorizationError("FORBIDDEN");
    if (self && actor.role !== "EMPLOYER_VERIFIER") throw new AuthorizationError("FORBIDDEN");
    if (self && input.active) throw new AuthorizationError("FORBIDDEN");
    if (input.active) {
      const target = await tx.query<{ role: string; isActive: boolean }>("SELECT role::text AS role, is_active AS \"isActive\" FROM master.user_profiles WHERE user_id = $1::uuid FOR SHARE", [targetUserId]);
      if (target.rows[0]?.role !== "EMPLOYER_VERIFIER" || target.rows[0].isActive !== true) throw new AuthorizationError("FORBIDDEN");
    }
    const result = await tx.query("UPDATE trust.verifier_org_members SET is_active = $2 WHERE user_id = $1::uuid", [targetUserId, input.active]);
    if (result.rowCount !== 1) throw new AuthorizationError("FORBIDDEN");
  });
}
