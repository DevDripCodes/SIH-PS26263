// Standalone worker process (npm run dev:worker). The API also starts one in-process unless
// WORKER_IN_API=false, so a separate worker is only needed to scale out.
import { redisUrl } from "../config/redis.js";
import { startValidationWorker } from "./processors/validation.processor.js";

if (!redisUrl()) {
  console.error("REDIS_URL is not set; validation jobs run inside the API process instead.");
  process.exit(1);
}

const worker = startValidationWorker(Number(process.env.WORKER_CONCURRENCY ?? 4));
console.log("Validation worker started.");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void worker.close().then(() => process.exit(0));
  });
}
