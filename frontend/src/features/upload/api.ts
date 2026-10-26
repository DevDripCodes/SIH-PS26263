import { api } from '@/api/client';
import { downloadFile } from '@/api/download';
import type { Batch, BatchScope, ColumnMapping, FilePreview, Institution, StudentRow } from './types';

export async function listInstitutions(): Promise<Institution[]> {
  const { data } = await api.get<{ institutions: Institution[] }>('/ingestion/institutions');
  return data.institutions;
}

export async function previewFile(file: File): Promise<FilePreview> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<FilePreview>('/ingestion/preview', form);
  return data;
}

export async function uploadFile(
  file: File,
  scope: BatchScope,
  options: { allowDuplicate?: boolean; onProgress?: (percent: number) => void } = {},
): Promise<{ batch: Batch; mapping: ColumnMapping }> {
  const form = new FormData();
  form.append('institutionId', scope.institutionId);
  form.append('academicYear', scope.academicYear);
  if (options.allowDuplicate) form.append('allowDuplicate', 'true');
  form.append('file', file);
  const { data } = await api.post<{ batch: Batch; mapping: ColumnMapping }>('/ingestion/upload', form, {
    onUploadProgress: (e) => {
      if (e.total) options.onProgress?.(Math.round((e.loaded / e.total) * 100));
    },
  });
  return data;
}

export async function submitForm(scope: BatchScope, records: StudentRow[]): Promise<Batch> {
  const { data } = await api.post<{ batch: Batch }>('/ingestion/form', { ...scope, records });
  return data.batch;
}

export async function listBatches(institutionId: string): Promise<Batch[]> {
  const { data } = await api.get<{ batches: Batch[] }>('/ingestion/batches', { params: { institutionId } });
  return data.batches;
}

export function downloadTemplate(format: 'csv' | 'xlsx'): Promise<void> {
  return downloadFile('/ingestion/template', `apaar_enrolment_template.${format}`, { format });
}
