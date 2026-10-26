import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuthenticated } from "./auth.middleware.js";
import { assignableRolesFor, assignRole, RoleAssignmentError } from "./roles.service.js";
import { SupabaseAuthError } from "./supabase-auth.service.js";

const assignmentSchema = z
  .object({
    email: z.string().trim().pipe(z.email()).transform((email) => email.toLowerCase()),
    fullName: z.string().trim().min(1).max(200),
    role: z.enum([
      "AICTE_REGIONAL_OFFICER",
      "AFFILIATING_BODY_REGISTRAR",
      "INSTITUTION_NODAL_OFFICER",
      "EMPLOYER_VERIFIER",
      "STUDENT",
    ]),
    institutionId: z.uuid().optional(),
    affiliatingBodyId: z.uuid().optional(),
    aicteRegion: z.string().trim().max(30).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.role === "AICTE_REGIONAL_OFFICER" && !input.aicteRegion) {
      context.addIssue({ code: "custom", path: ["aicteRegion"], message: "AICTE region is required." });
    }
    if (input.role === "AFFILIATING_BODY_REGISTRAR" && !input.affiliatingBodyId) {
      context.addIssue({ code: "custom", path: ["affiliatingBodyId"], message: "Affiliating body is required." });
    }
    if (input.role === "INSTITUTION_NODAL_OFFICER" && !input.institutionId) {
      context.addIssue({ code: "custom", path: ["institutionId"], message: "Institution is required." });
    }
    if (input.role !== "AICTE_REGIONAL_OFFICER" && input.aicteRegion) {
      context.addIssue({ code: "custom", path: ["aicteRegion"], message: "AICTE region only applies to regional officers." });
    }
    if (input.role !== "AFFILIATING_BODY_REGISTRAR" && input.affiliatingBodyId) {
      context.addIssue({ code: "custom", path: ["affiliatingBodyId"], message: "Affiliating body only applies to registrars." });
    }
    if (input.role !== "INSTITUTION_NODAL_OFFICER" && input.institutionId) {
      context.addIssue({ code: "custom", path: ["institutionId"], message: "Institution only applies to nodal officer assignments." });
    }
  });

const assignmentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

export const rolesRouter = Router();
rolesRouter.use(requireAuthenticated);

rolesRouter.get("/assignable", (request, response) => {
  const actor = request.authenticatedUser;
  if (!actor) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }
  response.json({ roles: assignableRolesFor(actor.role) });
});

rolesRouter.post("/assignments", assignmentLimiter, async (request, response, next) => {
  const parsed = assignmentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid role assignment.", details: z.flattenError(parsed.error) });
    return;
  }

  const actor = request.authenticatedUser;
  if (!actor) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    const result = await assignRole(actor, parsed.data);
    if (result.generatedPassword) response.setHeader("Cache-Control", "no-store");
    response.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    if (error instanceof RoleAssignmentError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof SupabaseAuthError) {
      response.status(503).json({ error: "Authentication service is temporarily unavailable." });
      return;
    }
    next(error);
  }
});
