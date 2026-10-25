import axios, { isAxiosError } from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export const api = axios.create({ baseURL: API_BASE_URL });

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
