export interface SupabaseUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: SupabaseUser;
}

export class SupabaseAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super("Supabase Auth request failed.");
    this.name = "SupabaseAuthError";
  }
}

interface SupabaseAuthConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

function getConfig(): SupabaseAuthConfig {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const publishableKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!url || !publishableKey || !secretKey) {
    throw new SupabaseAuthError(503, "AUTH_NOT_CONFIGURED");
  }

  return { url, publishableKey, secretKey };
}

async function authRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    accessToken?: string;
    admin?: boolean;
  } = {},
): Promise<T> {
  const config = getConfig();
  const apiKey = options.admin ? config.secretKey : config.publishableKey;
  const headers: Record<string, string> = {
    apikey: apiKey,
    Accept: "application/json",
  };

  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  } else if (options.admin) {
    headers.Authorization = `Bearer ${config.secretKey}`;
  }

  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new SupabaseAuthError(503, "AUTH_PROVIDER_UNAVAILABLE");
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as
      | { code?: unknown; error_code?: unknown }
      | null;
    const code =
      typeof errorBody?.code === "string"
        ? errorBody.code
        : typeof errorBody?.error_code === "string"
          ? errorBody.error_code
          : "AUTH_REQUEST_FAILED";
    throw new SupabaseAuthError(response.status, code);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function signInWithPassword(email: string, password: string): Promise<SupabaseSession> {
  return authRequest<SupabaseSession>("/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
}

export function refreshSession(refreshToken: string): Promise<SupabaseSession> {
  return authRequest<SupabaseSession>("/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
}

export function getSupabaseUser(accessToken: string): Promise<SupabaseUser> {
  return authRequest<SupabaseUser>("/user", { accessToken });
}

export function createSupabaseUser(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<SupabaseUser> {
  return authRequest<SupabaseUser>("/admin/users", {
    method: "POST",
    admin: true,
    body: {
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    },
  });
}

export async function deleteSupabaseUser(userId: string): Promise<void> {
  await authRequest<void>(`/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    admin: true,
  });
}

export async function signOutSupabaseSession(accessToken: string): Promise<void> {
  await authRequest<void>("/logout?scope=local", {
    method: "POST",
    accessToken,
  });
}
