export interface AuthUser {
  userId: string;
  email: string;
  fullName: string;
  role:
    | 'AICTE_SUPER_ADMIN'
    | 'AICTE_REGIONAL_OFFICER'
    | 'AFFILIATING_BODY_REGISTRAR'
    | 'INSTITUTION_NODAL_OFFICER'
    | 'EMPLOYER_VERIFIER'
    | 'STUDENT';
  institutionId: string | null;
  affiliatingBodyId: string | null;
  aicteRegion: string | null;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  user: AuthUser;
}

const SESSION_STORAGE_KEY = 'apaar.auth.session';
export const AUTH_SESSION_EXPIRED_EVENT = 'apaar:auth-session-expired';

function readStoredSession(): AuthSession | null {
  try {
    const value = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!value) return null;

    const session = JSON.parse(value) as AuthSession;
    if (
      typeof session.accessToken !== 'string' ||
      typeof session.refreshToken !== 'string' ||
      !session.user
    ) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

let currentSession = readStoredSession();

export function getAuthSession(): AuthSession | null {
  return currentSession;
}

export function hasAuthSession(): boolean {
  return Boolean(currentSession?.accessToken && currentSession.refreshToken);
}

export function saveAuthSession(session: AuthSession): void {
  currentSession = session;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Keep the in-memory session usable when browser storage is unavailable.
  }
}

export function clearAuthSession(): void {
  currentSession = null;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // The in-memory session is still cleared when browser storage is unavailable.
  }
}

export function expireAuthSession(): void {
  clearAuthSession();
  window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
}
