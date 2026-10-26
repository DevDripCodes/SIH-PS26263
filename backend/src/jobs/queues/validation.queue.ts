import { Queue } from "bullmq";
import { createRedisConnection, redisUrl } from "../../config/redis.js";
import { processValidationJob } from "../processors/validation.processor.js";

export const VALIDATION_QUEUE = "batch-validation";

export type ValidationJob =
  | { kind: "validate"; batchId: string }
  | { kind: "promote"; batchId: string; actorUserId: string | null };

let queue: Queue<ValidationJob> | null = null;

function getQueue(): Queue<ValidationJob> {
  queue ??= new Queue<ValidationJob>(VALIDATION_QUEUE, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    },
  });
  return queue;
}

/**
 * Queue a batch for validation or promotion. Without REDIS_URL the job runs in this process
 * right after the response is sent (single attempt), which is enough for local development.
 */
export async function enqueueValidationJob(job: ValidationJob): Promise<string> {
  if (!redisUrl()) {
    setImmediate(() => {
      processValidationJob(job, { finalAttempt: true }).catch((err: unknown) => {
        console.error(`[validation] inline ${job.kind} job for batch ${job.batchId} failed`, err);
      });
    });
    return `inline-${job.kind}-${job.batchId}`;
  }
  const added = await getQueue().add(job.kind, job, { jobId: `${job.kind}-${job.batchId}-${Date.now()}` });
  return added.id!;
}
