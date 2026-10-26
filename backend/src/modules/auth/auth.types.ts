export const USER_ROLES = [
  "AICTE_SUPER_ADMIN",
  "AICTE_REGIONAL_OFFICER",
  "AFFILIATING_BODY_REGISTRAR",
  "INSTITUTION_NODAL_OFFICER",
  "EMPLOYER_VERIFIER",
  "STUDENT",
] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type AssignableRole = Exclude<UserRole, "AICTE_SUPER_ADMIN">;

export interface AuthenticatedUser {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  institutionId: string | null;
  affiliatingBodyId: string | null;
  aicteRegion: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    authenticatedUser?: AuthenticatedUser;
    accessToken?: string;
  }
}
