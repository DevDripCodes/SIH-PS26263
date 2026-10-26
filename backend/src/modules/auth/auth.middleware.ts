import type { NextFunction, Request, Response } from "express";
import { getActiveUserProfile } from "./auth-profile.service.js";
import type { UserRole } from "./auth.types.js";
import { getSupabaseUser, SupabaseAuthError } from "./supabase-auth.service.js";

function bearerToken(request: Request): string | null {
  const value = request.headers.authorization;
  if (!value) return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  return match?.[1] ?? null;
}

export function requireAuthenticated(request: Request, response: Response, next: NextFunction): void {
  const token = bearerToken(request);
  if (!token) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  void (async () => {
    const authUser = await getSupabaseUser(token);
    const profile = await getActiveUserProfile(authUser.id);
    if (!profile) {
      response.status(403).json({ error: "This account has no active role. Contact an administrator." });
      return;
    }

    request.authenticatedUser = profile;
    request.accessToken = token;
    next();
  })().catch((error: unknown) => {
    if (error instanceof SupabaseAuthError) {
      if (error.status >= 500) {
        response.status(503).json({ error: "Authentication service is temporarily unavailable." });
      } else {
        response.status(401).json({ error: "Invalid or expired access token." });
      }
      return;
    }
    next(error);
  });
}

export function requireRoles(...roles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.authenticatedUser) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!roles.includes(request.authenticatedUser.role)) {
      response.status(403).json({ error: "Authorization request denied." });
      return;
    }
    next();
  };
}

export function getBearerToken(request: Request): string | null {
  return bearerToken(request);
}
