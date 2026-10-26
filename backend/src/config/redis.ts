import { Redis, type RedisOptions } from "ioredis";

/**
 * BullMQ needs a TCP Redis URL. For Upstash use the `rediss://` (TLS) URL, not the REST URL.
 * Leave REDIS_URL empty to run validation jobs in-process instead (local development without Redis).
 */
export function redisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url ? url : null;
}

export function createRedisConnection(): Redis {
  const url = redisUrl();
  if (!url) throw new Error("REDIS_URL is not set.");
  const options: RedisOptions = {
    maxRetriesPerRequest: null, // required by BullMQ workers
    enableReadyCheck: false,
  };
  return new Redis(url, options);
}
