import { api } from '@/api/client';
import { downloadFile } from '@/api/download';
import type { Batch } from '@/features/upload/types';
import type { AnomalyFilter, AnomalyPage, PromotionForecast, ValidationReport } from './types';

const base = (batchId: string) => `/validation/batches/${batchId}`;

export async function getValidationReport(batchId: string): Promise<ValidationReport> {
  const { data } = await api.get<ValidationReport>(base(batchId));
  return data;
}

export async function listAnomalies(batchId: string, filter: AnomalyFilter, pageSize = 25): Promise<AnomalyPage> {
  const { data } = await api.get<AnomalyPage>(`${base(batchId)}/anomalies`, { params: { ...filter, pageSize } });
  return data;
}

export function downloadCorrections(batchId: string): Promise<void> {
  return downloadFile(`${base(batchId)}/corrections.csv`, `corrections_${batchId.slice(0, 8)}.csv`);
}

export async function precheckBatch(batchId: string): Promise<PromotionForecast> {
  const { data } = await api.post<{ forecast: PromotionForecast }>(`${base(batchId)}/precheck`);
  return data.forecast;
}

export async function approveBatch(batchId: string): Promise<Batch> {
  const { data } = await api.post<{ batch: Batch }>(`${base(batchId)}/approve`);
  return data.batch;
}

export async function cancelBatch(batchId: string): Promise<Batch> {
  const { data } = await api.post<{ batch: Batch }>(`${base(batchId)}/cancel`);
  return data.batch;
}

export async function retryBatch(batchId: string): Promise<Batch> {
  const { data } = await api.post<{ batch: Batch }>(`${base(batchId)}/retry`);
  return data.batch;
}
