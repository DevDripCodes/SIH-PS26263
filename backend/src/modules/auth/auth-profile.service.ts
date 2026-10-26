import type { QueryResultRow } from "pg";
import { pool } from "../../db/pool.js";
import type { AuthenticatedUser, UserRole } from "./auth.types.js";

interface UserProfileRow extends QueryResultRow {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  institutionId: string | null;
  affiliatingBodyId: string | null;
  aicteRegion: string | null;
}

const VALID_ROLES = new Set<UserRole>([
  "AICTE_SUPER_ADMIN",
  "AICTE_REGIONAL_OFFICER",
  "AFFILIATING_BODY_REGISTRAR",
  "INSTITUTION_NODAL_OFFICER",
  "EMPLOYER_VERIFIER",
  "STUDENT",
]);

export async function getActiveUserProfile(userId: string): Promise<AuthenticatedUser | null> {
  const result = await pool.query<UserProfileRow>(
    `SELECT
       up.user_id::text AS "userId",
       u.email,
       up.full_name AS "fullName",
       up.role::text AS role,
       up.institution_id::text AS "institutionId",
       up.affiliating_body_id::text AS "affiliatingBodyId",
       up.aicte_region AS "aicteRegion"
     FROM master.user_profiles AS up
     JOIN auth.users AS u ON u.id = up.user_id
     WHERE up.user_id = $1::uuid
       AND up.is_active = TRUE
     LIMIT 1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row || !VALID_ROLES.has(row.role as UserRole) || typeof row.email !== "string") return null;

  return {
    userId: row.userId,
    email: row.email,
    fullName: row.fullName,
    role: row.role as UserRole,
    institutionId: row.institutionId,
    affiliatingBodyId: row.affiliatingBodyId,
    aicteRegion: row.aicteRegion,
  };
}
