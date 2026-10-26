import type { Request } from "express";
import { HttpError } from "../../utils/http-error.js";
import type { AuthenticatedUser } from "./auth.types.js";

export function actorFor(req: Request): AuthenticatedUser {
  const actor = req.authenticatedUser;
  if (!actor) throw new HttpError("Authentication required.", 401);
  return actor;
}

/** Institution data (uploads, batches, validation reports) is open to AICTE super admins and the institution's own nodal officer. */
export function assertInstitutionAccess(actor: AuthenticatedUser, institutionId: string): void {
  if (actor.role === "AICTE_SUPER_ADMIN") return;
  if (actor.role === "INSTITUTION_NODAL_OFFICER" && actor.institutionId === institutionId) return;
  throw new HttpError("Authorization request denied.", 403);
}
