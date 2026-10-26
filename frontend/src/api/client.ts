import axios, { isAxiosError, type InternalAxiosRequestConfig } from 'axios';
import {
  expireAuthSession,
  getAuthSession,
  saveAuthSession,
  type AuthSession,
} from './auth-session';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export const api = axios.create({ baseURL: API_BASE_URL });

function isLoginOrRefreshRequest(url = ''): boolean {
  return /\/auth\/(login|refresh)(?:\?|$)/.test(url);
}

function isAuthEndpoint(url = ''): boolean {
  return /\/auth\/(login|refresh|logout)(?:\?|$)/.test(url);
}

api.interceptors.request.use((config) => {
  if (!isLoginOrRefreshRequest(config.url)) {
    const session = getAuthSession();
    if (session?.accessToken) config.headers.set('Authorization', `Bearer ${session.accessToken}`);
  }
  return config;
});

type RetriableRequestConfig = InternalAxiosRequestConfig & { _authRetry?: boolean };
let refreshInFlight: Promise<AuthSession> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!isAxiosError(error) || error.response?.status !== 401 || !error.config) {
      return Promise.reject(error);
    }

    const request = error.config as RetriableRequestConfig;
    if (isAuthEndpoint(request.url)) return Promise.reject(error);
    if (request._authRetry) {
      expireAuthSession();
      return Promise.reject(error);
    }

    const session = getAuthSession();
    if (!session?.refreshToken) {
      expireAuthSession();
      return Promise.reject(error);
    }

    request._authRetry = true;
    if (!refreshInFlight) {
      refreshInFlight = axios
        .post<AuthSession>(`${API_BASE_URL}/auth/refresh`, {
          refreshToken: session.refreshToken,
        })
        .then(({ data }) => {
          saveAuthSession(data);
          return data;
        })
        .catch((refreshError: unknown) => {
          expireAuthSession();
          throw refreshError;
        })
        .finally(() => {
          refreshInFlight = null;
        });
    }

    try {
      const refreshedSession = await refreshInFlight;
      request.headers.set('Authorization', `Bearer ${refreshedSession.accessToken}`);
      return await api(request);
    } catch (refreshError) {
      return Promise.reject(refreshError);
    }
  },
);

/** Pull the server's `{ error }` message out of a failed request, falling back to something readable. */
export function apiErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const message = (err.response?.data as { error?: string } | undefined)?.error;
    if (message) return message;
    if (!err.response) return `Cannot reach the API at ${API_BASE_URL}. Is the backend running?`;
    return `Request failed (${err.response.status}).`;
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}
