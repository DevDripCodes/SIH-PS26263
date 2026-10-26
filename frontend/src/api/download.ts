import { api } from './client';

/** Fetch a file through the authenticated API client and hand it to the browser as a download. */
export async function downloadFile(path: string, fallbackName: string, params?: Record<string, string>): Promise<void> {
  const response = await api.get<Blob>(path, { params, responseType: 'blob' });
  const disposition = String(response.headers['content-disposition'] ?? '');
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;

  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
