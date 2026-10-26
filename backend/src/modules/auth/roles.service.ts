import { randomInt, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import type { AssignableRole, AuthenticatedUser, UserRole } from "./auth.types.js";
import { createSupabaseUser, deleteSupabaseUser, SupabaseAuthError } from "./supabase-auth.service.js";

export const ROLE_ASSIGNMENTS: Readonly<Record<UserRole, readonly AssignableRole[]>> = {
  AICTE_SUPER_ADMIN: ["AICTE_REGIONAL_OFFICER", "AFFILIATING_BODY_REGISTRAR"],
  AICTE_REGIONAL_OFFICER: ["INSTITUTION_NODAL_OFFICER"],
  AFFILIATING_BODY_REGISTRAR: ["INSTITUTION_NODAL_OFFICER"],
  INSTITUTION_NODAL_OFFICER: ["EMPLOYER_VERIFIER", "STUDENT"],
  EMPLOYER_VERIFIER: [],
  STUDENT: [],
};

const AICTE_REGIONS = new Set([
  "NORTH",
  "NORTH_WEST",
  "SOUTH",
  "SOUTH_WEST",
  "CENTRAL",
  "EAST",
  "WEST",
  "SOUTH_CENTRAL",
]);

const PASSWORD_UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PASSWORD_LOWER = "abcdefghijklmnopqrstuvwxyz";
const PASSWORD_DIGITS = "0123456789";
const PASSWORD_SYMBOLS = "-_";
const PASSWORD_ALPHABET = `${PASSWORD_UPPER}${PASSWORD_LOWER}${PASSWORD_DIGITS}${PASSWORD_SYMBOLS}`;

export class RoleAssignmentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RoleAssignmentError";
  }
}

export interface RoleAssignmentInput {
  email: string;
  fullName: string;
  role: AssignableRole;
  institutionId?: string;
  affiliatingBodyId?: string;
  aicteRegion?: string;
}

interface ActorRow extends QueryResultRow {
  userId: string;
  role: string;
  institutionId: string | null;
  affiliatingBodyId: string | null;
  aicteRegion: string | null;
  isActive: boolean;
}

interface TargetProfileRow extends ActorRow {
  fullName: string;
}

interface InstitutionRow extends QueryResultRow {
  institutionId: string;
  affiliatingBodyId: string | null;
  aicteRegion: string;
}

interface ResolvedScope {
  institutionId: string | null;
  affiliatingBodyId: string | null;
  aicteRegion: string | null;
}

function isUserRole(role: string): role is UserRole {
  return Object.hasOwn(ROLE_ASSIGNMENTS, role);
}

function forbidden(): RoleAssignmentError {
  return new RoleAssignmentError(403, "Authorization request denied.");
}

export function generatePermanentPassword(): string {
  const characters = [
    PASSWORD_UPPER[randomInt(PASSWORD_UPPER.length)]!,
    PASSWORD_LOWER[randomInt(PASSWORD_LOWER.length)]!,
    PASSWORD_DIGITS[randomInt(PASSWORD_DIGITS.length)]!,
    PASSWORD_SYMBOLS[randomInt(PASSWORD_SYMBOLS.length)]!,
  ];
  while (characters.length < 18) characters.push(PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]!);
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j]!, characters[i]!];
  }
  return characters.join("");
}

export function assignableRolesFor(role: UserRole): AssignableRole[] {
  return [...ROLE_ASSIGNMENTS[role]];
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const result = await pool.query<{ userId: string }>(
    "SELECT id::text AS \"userId\" FROM auth.users WHERE lower(email) = lower($1) LIMIT 1",
    [email],
  );
  return result.rows[0]?.userId ?? null;
}

async function lockActor(client: PoolClient, userId: string): Promise<ActorRow> {
  const result = await client.query<ActorRow>(
    `SELECT
       user_id::text AS "userId",
       role::text AS role,
       institution_id::text AS "institutionId",
       affiliating_body_id::text AS "affiliatingBodyId",
       aicte_region AS "aicteRegion",
       is_active AS "isActive"
     FROM master.user_profiles
     WHERE user_id = $1::uuid
     FOR SHARE`,
    [userId],
  );
  const actor = result.rows[0];
  if (!actor || !actor.isActive || !isUserRole(actor.role)) throw forbidden();
  return actor;
}

async function lockTargetProfile(client: PoolClient, userId: string): Promise<TargetProfileRow | null> {
  const result = await client.query<TargetProfileRow>(
    `SELECT
       user_id::text AS "userId",
       role::text AS role,
       institution_id::text AS "institutionId",
       affiliating_body_id::text AS "affiliatingBodyId",
       aicte_region AS "aicteRegion",
       full_name AS "fullName",
       is_active AS "isActive"
     FROM master.user_profiles
     WHERE user_id = $1::uuid
     FOR UPDATE`,
    [userId],
  );
  const target = result.rows[0];
  if (!target) return null;
  if (!target.isActive) throw new RoleAssignmentError(409, "Inactive accounts cannot be changed through role assignment.");
  if (!isUserRole(target.role)) throw forbidden();
  return target;
}

function ensureGrantAllowed(actorRole: UserRole, targetRole: AssignableRole): void {
  if (!ROLE_ASSIGNMENTS[actorRole].includes(targetRole)) throw forbidden();
}

async function institutionById(client: PoolClient, institutionId: string): Promise<InstitutionRow> {
  const result = await client.query<InstitutionRow>(
    `SELECT
       institution_id::text AS "institutionId",
       affiliating_body_id::text AS "affiliatingBodyId",
       aicte_region AS "aicteRegion"
     FROM master.institutions
     WHERE institution_id = $1::uuid`,
    [institutionId],
  );
  const institution = result.rows[0];
  if (!institution) throw new RoleAssignmentError(404, "Institution not found.");
  return institution;
}

async function resolveScope(
  client: PoolClient,
  actor: ActorRow,
  input: RoleAssignmentInput,
): Promise<ResolvedScope> {
  switch (input.role) {
    case "AICTE_REGIONAL_OFFICER": {
      const region = input.aicteRegion?.trim().toUpperCase();
      if (!region || !AICTE_REGIONS.has(region)) {
        throw new RoleAssignmentError(400, "A valid AICTE region is required for a regional officer.");
      }
      return { institutionId: null, affiliatingBodyId: null, aicteRegion: region };
    }
    case "AFFILIATING_BODY_REGISTRAR": {
      if (!input.affiliatingBodyId) {
        throw new RoleAssignmentError(400, "An affiliating body is required for a registrar.");
      }
      const result = await client.query(
        "SELECT 1 FROM master.affiliating_bodies WHERE affiliating_body_id = $1::uuid AND is_active = TRUE",
        [input.affiliatingBodyId],
      );
      if (result.rowCount === 0) throw new RoleAssignmentError(404, "Active affiliating body not found.");
      return { institutionId: null, affiliatingBodyId: input.affiliatingBodyId, aicteRegion: null };
    }
    case "INSTITUTION_NODAL_OFFICER": {
      if (!input.institutionId) {
        throw new RoleAssignmentError(400, "An institution is required for a nodal officer.");
      }
      const institution = await institutionById(client, input.institutionId);
      if (
        actor.role === "AICTE_REGIONAL_OFFICER" &&
        (!actor.aicteRegion || actor.aicteRegion !== institution.aicteRegion)
      ) {
        throw forbidden();
      }
      if (
        actor.role === "AFFILIATING_BODY_REGISTRAR" &&
        (!actor.affiliatingBodyId || actor.affiliatingBodyId !== institution.affiliatingBodyId)
      ) {
        throw forbidden();
      }
      return { institutionId: institution.institutionId, affiliatingBodyId: null, aicteRegion: null };
    }
    case "EMPLOYER_VERIFIER":
    case "STUDENT": {
      if (actor.role !== "INSTITUTION_NODAL_OFFICER" || !actor.institutionId) throw forbidden();
      return { institutionId: actor.institutionId, affiliatingBodyId: null, aicteRegion: null };
    }
  }
}

async function ensureCurrentTargetWithinActorScope(
  client: PoolClient,
  actor: ActorRow,
  current: TargetProfileRow,
): Promise<void> {
  if (actor.role === "AICTE_SUPER_ADMIN") return;

  if (actor.role === "AICTE_REGIONAL_OFFICER" && current.role === "INSTITUTION_NODAL_OFFICER") {
    if (!current.institutionId || !actor.aicteRegion) throw forbidden();
    const institution = await institutionById(client, current.institutionId);
    if (institution.aicteRegion !== actor.aicteRegion) throw forbidden();
    return;
  }

  if (actor.role === "AFFILIATING_BODY_REGISTRAR" && current.role === "INSTITUTION_NODAL_OFFICER") {
    if (!current.institutionId || !actor.affiliatingBodyId) throw forbidden();
    const institution = await institutionById(client, current.institutionId);
    if (institution.affiliatingBodyId !== actor.affiliatingBodyId) throw forbidden();
    return;
  }

  if (
    actor.role === "INSTITUTION_NODAL_OFFICER" &&
    (current.role === "EMPLOYER_VERIFIER" || current.role === "STUDENT") &&
    actor.institutionId &&
    current.institutionId === actor.institutionId
  ) {
    return;
  }

  throw forbidden();
}

function requireChangedRoleManageable(
  actor: ActorRow,
  current: TargetProfileRow | null,
  actorUserId: string,
  targetUserId: string,
  newRole: AssignableRole,
): void {
  ensureGrantAllowed(actor.role as UserRole, newRole);
  if (!current) return;
  if (actorUserId === targetUserId) throw forbidden();
  if (!ROLE_ASSIGNMENTS[actor.role as UserRole].includes(current.role as AssignableRole)) throw forbidden();
}

export interface RoleAssignmentResult {
  user: {
    userId: string;
    email: string;
    fullName: string;
    role: AssignableRole;
    institutionId: string | null;
    affiliatingBodyId: string | null;
    aicteRegion: string | null;
  };
  created: boolean;
  generatedPassword?: string;
}

export async function assignRole(
  authenticatedActor: AuthenticatedUser,
  input: RoleAssignmentInput,
): Promise<RoleAssignmentResult> {
  // Reject unauthorized grant attempts before creating any Auth-side account.
  ensureGrantAllowed(authenticatedActor.role, input.role);
  const email = input.email.trim().toLowerCase();
  const existingAuthUserId = await findAuthUserIdByEmail(email);
  const generatedPassword = existingAuthUserId ? undefined : generatePermanentPassword();

  let targetUserId = existingAuthUserId;
  let createdAuthUser = false;
  if (!targetUserId) {
    try {
      const createdUser = await createSupabaseUser({
        email,
        password: generatedPassword!,
        fullName: input.fullName,
      });
      targetUserId = createdUser.id;
      createdAuthUser = true;
    } catch (error) {
      if (error instanceof SupabaseAuthError && (error.status === 409 || error.status === 422)) {
        throw new RoleAssignmentError(409, "An account with this email already exists; retry the assignment.");
      }
      throw error;
    }
  }

  if (!targetUserId) throw new Error("Supabase Auth returned no user ID.");

  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(
      "SELECT set_config('app.actor_user_id', $1, true), set_config('app.request_id', $2, true)",
      [authenticatedActor.userId, randomUUID()],
    );

    const actor = await lockActor(client, authenticatedActor.userId);
    if (actor.userId === targetUserId) throw forbidden();

    const current = await lockTargetProfile(client, targetUserId);
    if (existingAuthUserId && !current) {
      throw new RoleAssignmentError(409, "This Auth account has no role profile and needs administrator reconciliation.");
    }

    requireChangedRoleManageable(actor, current, actor.userId, targetUserId, input.role);
    if (current) await ensureCurrentTargetWithinActorScope(client, actor, current);
    const scope = await resolveScope(client, actor, input);

    if (current) {
      await client.query(
        `UPDATE master.user_profiles
         SET role = $2::master.user_role_enum,
             institution_id = $3::uuid,
             affiliating_body_id = $4::uuid,
             aicte_region = $5,
             full_name = $6
         WHERE user_id = $1::uuid`,
        [targetUserId, input.role, scope.institutionId, scope.affiliatingBodyId, scope.aicteRegion, input.fullName.trim()],
      );
    } else {
      await client.query(
        `INSERT INTO master.user_profiles
           (user_id, role, institution_id, affiliating_body_id, aicte_region, full_name)
         VALUES ($1::uuid, $2::master.user_role_enum, $3::uuid, $4::uuid, $5, $6)`,
        [targetUserId, input.role, scope.institutionId, scope.affiliatingBodyId, scope.aicteRegion, input.fullName.trim()],
      );
    }

    await client.query(
      `SELECT trust.log_audit_event(
         'app_master',
         $1,
         'USER_PROFILE',
         $2::uuid,
         NULL,
         $3::jsonb
       )`,
      [
        current ? "USER_ROLE.CHANGED" : "USER_ROLE.ASSIGNED",
        targetUserId,
        JSON.stringify({ old_role: current?.role ?? null, new_role: input.role }),
      ],
    );

    await client.query("COMMIT");
    transactionOpen = false;

    return {
      user: {
        userId: targetUserId,
        email,
        fullName: input.fullName.trim(),
        role: input.role,
        institutionId: scope.institutionId,
        affiliatingBodyId: scope.affiliatingBodyId,
        aicteRegion: scope.aicteRegion,
      },
      created: createdAuthUser,
      ...(createdAuthUser && generatedPassword ? { generatedPassword } : {}),
    };
  } catch (error) {
    if (transactionOpen && client) await client.query("ROLLBACK").catch(() => undefined);
    if (createdAuthUser) {
      await deleteSupabaseUser(targetUserId).catch(() => undefined);
    }
    throw error;
  } finally {
    client?.release();
  }
}
