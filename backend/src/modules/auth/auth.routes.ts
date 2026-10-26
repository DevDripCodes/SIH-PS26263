import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getActiveUserProfile } from "./auth-profile.service.js";
import { getBearerToken, requireAuthenticated } from "./auth.middleware.js";
import {
  refreshSession,
  signInWithPassword,
  signOutSupabaseSession,
  SupabaseAuthError,
} from "./supabase-auth.service.js";

const loginBody = z.object({
  email: z.string().trim().pipe(z.email()).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(1024),
});

const refreshBody = z.object({ refreshToken: z.string().min(1).max(4096) });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

export const authRouter = Router();

function sessionResponse(session: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}, user: Awaited<ReturnType<typeof getActiveUserProfile>>) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    tokenType: session.token_type,
    user,
  };
}

authRouter.post("/login", loginLimiter, async (request, response) => {
  const parsed = loginBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Provide a valid email and password." });
    return;
  }

  try {
    const session = await signInWithPassword(parsed.data.email, parsed.data.password);
    const profile = await getActiveUserProfile(session.user.id);
    if (!profile) {
      await signOutSupabaseSession(session.access_token).catch(() => undefined);
      response.status(403).json({ error: "This account has no active role. Contact an administrator." });
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.json(sessionResponse(session, profile));
  } catch (error) {
    if (error instanceof SupabaseAuthError) {
      if (error.status >= 500 || error.status === 503) {
        response.status(503).json({ error: "Authentication service is temporarily unavailable." });
      } else {
        response.status(401).json({ error: "Invalid email or password." });
      }
      return;
    }
    throw error;
  }
});

authRouter.post("/refresh", refreshLimiter, async (request, response) => {
  const parsed = refreshBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "A refresh token is required." });
    return;
  }

  try {
    const session = await refreshSession(parsed.data.refreshToken);
    const profile = await getActiveUserProfile(session.user.id);
    if (!profile) {
      await signOutSupabaseSession(session.access_token).catch(() => undefined);
      response.status(403).json({ error: "This account has no active role. Contact an administrator." });
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.json(sessionResponse(session, profile));
  } catch (error) {
    if (error instanceof SupabaseAuthError) {
      if (error.status >= 500 || error.status === 503) {
        response.status(503).json({ error: "Authentication service is temporarily unavailable." });
      } else {
        response.status(401).json({ error: "Invalid or expired refresh token." });
      }
      return;
    }
    throw error;
  }
});

authRouter.get("/me", requireAuthenticated, (request, response) => {
  response.json({ user: request.authenticatedUser });
});

authRouter.post("/logout", async (request, response) => {
  const token = getBearerToken(request);
  if (!token) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    await signOutSupabaseSession(token);
    response.status(204).end();
  } catch (error) {
    if (error instanceof SupabaseAuthError) {
      if (error.status >= 500 || error.status === 503) {
        response.status(503).json({ error: "Authentication service is temporarily unavailable." });
      } else {
        response.status(401).json({ error: "Invalid or expired access token." });
      }
      return;
    }
    throw error;
  }
});
