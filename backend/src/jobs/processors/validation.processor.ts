import { UnrecoverableError, Worker } from "bullmq";
import { createRedisConnection } from "../../config/redis.js";
import { FieldEncryptionConfigError } from "../../lib/crypto/field-encryption.js";
import { markBatchFailed, promoteBatch, validateBatch } from "../../modules/validation/pipeline.js";
import type { ValidationJob } from "../queues/validation.queue.js";

export async function processValidationJob(job: ValidationJob, opts: { finalAttempt: boolean }): Promise<void> {
  try {
    if (job.kind === "validate") await validateBatch(job.batchId);
    else await promoteBatch(job.batchId, job.actorUserId);
  } catch (err) {
    const configError = err instanceof FieldEncryptionConfigError;
    if (opts.finalAttempt || configError) {
      await markBatchFailed(
        job.batchId,
        configError ? `Server configuration error: ${err.message}` : `Processing failed: ${(err as Error).message}`,
      );
    }
    // Retrying cannot fix a missing key, so tell BullMQ not to.
    throw configError ? new UnrecoverableError(err.message) : err;
  }
}

export function startValidationWorker(concurrency = 2): Worker<ValidationJob> {
  const worker = new Worker<ValidationJob>(
    "batch-validation",
    (job) => processValidationJob(job.data, { finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) }),
    {
      connection: createRedisConnection(),
      concurrency,
      // Hosted Redis (e.g. Upstash) bills per command: poll less often when the queue is idle.
      drainDelay: 30,
      stalledInterval: 120_000,
    },
  );
  worker.on("failed", (job, err) => {
    console.error(`[validation] ${job?.data.kind} job for batch ${job?.data.batchId} failed: ${err.message}`);
  });
  return worker;
}
