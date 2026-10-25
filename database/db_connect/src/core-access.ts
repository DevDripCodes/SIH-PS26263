import type { ActorContext } from "./actor-context";
import type { DbTx } from "./pool";
import { AuthorizationError } from "./authorization";

/** Proves student ownership or institution scope using canonical actor data and enrolment joins. */
export async function assertStudentReadable(tx: DbTx, actor: ActorContext, studentId: string): Promise<void> {
  const result = await tx.query<{ allowed: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM core.students s
    WHERE s.student_id = $1::uuid AND (
      EXISTS (SELECT 1 FROM core.student_accounts sa WHERE sa.student_id = s.student_id AND sa.user_id = $2::uuid)
      OR EXISTS (
        SELECT 1 FROM core.student_enrolments e JOIN master.institutions i ON i.institution_id = e.institution_id
        WHERE e.student_id = s.student_id AND (
          $3::boolean OR
          ($4::text = 'INSTITUTION_NODAL_OFFICER' AND i.institution_id = $5::uuid) OR
          ($4::text = 'AFFILIATING_BODY_REGISTRAR' AND i.affiliating_body_id = $6::uuid) OR
          ($4::text = 'AICTE_REGIONAL_OFFICER' AND i.aicte_region = $7::text)
        )
      )
    )
  ) AS allowed`, [studentId, actor.userId, actor.role === "AICTE_SUPER_ADMIN", actor.role, actor.institutionId, actor.affiliatingBodyId, actor.aicteRegion]);
  if (result.rows[0]?.allowed !== true) throw new AuthorizationError("FORBIDDEN");
}

export function enrolmentScopePredicate(actor: ActorContext, alias = "e", parameterIndex = 1): { sql: string; values: unknown[] } {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new TypeError("Invalid SQL alias.");
  if (actor.role === "AICTE_SUPER_ADMIN") return { sql: "TRUE", values: [] };
  const parameter = `$${parameterIndex}`;
  if (actor.role === "STUDENT") return { sql: `${alias}.student_id IN (SELECT sa.student_id FROM core.student_accounts sa WHERE sa.user_id = ${parameter}::uuid)`, values: [actor.userId] };
  if (actor.role === "INSTITUTION_NODAL_OFFICER" && actor.institutionId) return { sql: `${alias}.institution_id = ${parameter}::uuid`, values: [actor.institutionId] };
  if (actor.role === "AFFILIATING_BODY_REGISTRAR" && actor.affiliatingBodyId) return { sql: `EXISTS (SELECT 1 FROM master.institutions i WHERE i.institution_id = ${alias}.institution_id AND i.affiliating_body_id = ${parameter}::uuid)`, values: [actor.affiliatingBodyId] };
  if (actor.role === "AICTE_REGIONAL_OFFICER" && actor.aicteRegion) return { sql: `EXISTS (SELECT 1 FROM master.institutions i WHERE i.institution_id = ${alias}.institution_id AND i.aicte_region = ${parameter})`, values: [actor.aicteRegion] };
  throw new AuthorizationError("FORBIDDEN");
}
