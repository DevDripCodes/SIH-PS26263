import { api } from './client';
import {
  clearAuthSession,
  getAuthSession,
  saveAuthSession,
  type AuthSession,
  type AuthUser,
} from './auth-session';

export async function login(email: string, password: string): Promise<AuthSession> {
  const { data } = await api.post<AuthSession>('/auth/login', { email, password });
  saveAuthSession(data);
  return data;
}

export async function getCurrentUser(): Promise<AuthUser> {
  const { data } = await api.get<{ user: AuthUser }>('/auth/me');
  return data.user;
}

export async function logout(): Promise<void> {
  const session = getAuthSession();
  try {
    if (session?.accessToken) await api.post('/auth/logout');
  } finally {
    clearAuthSession();
  }
}
