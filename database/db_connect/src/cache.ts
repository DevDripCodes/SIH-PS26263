import {
  cacheGet as redisGet,
  cacheSet as redisSet,
  cacheDelete as redisDelete,
} from "./redis";
import { env } from "./env";

const KEY_PREFIX = "sih";
const SCHEMA_VERSION = "v1";
const MAX_KEY_LENGTH = 512;
const MAX_SEGMENT_LENGTH = 128;
const MAX_TTL_SECONDS = 86_400;

const ENV_NAMESPACE = {
  development: "dev",
  test: "test",
  production: "prod",
} as const;

type Environment = keyof typeof ENV_NAMESPACE;

export type CacheSchema =
  | "core"
  | "master"
  | "staging"
  | "trust"
  | "analytics";

export interface CacheKey {
  schema: CacheSchema;
  resource: string;
  identifier: string;
  generation: number;
}

export type CacheOperation = "read" | "write" | "delete";

export interface CacheRedisAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(
    key: string,
    value: T,
    ttlSeconds: number,
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export class CacheUnavailableError extends Error {
  constructor(operation: CacheOperation) {
    super(`Cache ${operation} unavailable`);
    this.name = "CacheUnavailableError";
  }
}

type CacheFailureReporter = (operation: CacheOperation) => void;

function getEnvironmentNamespace(): string {
  const nodeEnv = env.NODE_ENV as Environment;
  const namespace = ENV_NAMESPACE[nodeEnv];

  if (!namespace) {
    throw new Error("Invalid cache environment");
  }

  return namespace;
}

function validateSegment(
  value: string,
  field: string,
  pattern: RegExp,
): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SEGMENT_LENGTH ||
    !pattern.test(value)
  ) {
    throw new Error(`Invalid cache key ${field}`);
  }
}

export function buildCacheKey(key: CacheKey): string {
  if (!key || typeof key !== "object" || Array.isArray(key)) {
    throw new Error("Invalid cache key");
  }

  const { schema, resource, identifier, generation } = key;

  const allowedSchemas: readonly CacheSchema[] = [
    "core",
    "master",
    "staging",
    "trust",
    "analytics",
  ];

  if (!allowedSchemas.includes(schema)) {
    throw new Error("Invalid cache schema");
  }

  validateSegment(
    resource,
    "resource",
    /^[a-z][a-z0-9_-]*$/,
  );

  const isCollection = identifier === "all";

  const isUuid =
    typeof identifier === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      identifier,
    );

  if (!isCollection && !isUuid) {
    throw new Error(
      "Cache identifier must be a UUID or 'all'; sensitive identifier caching is disabled",
    );
  }

  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error(
      "Cache generation must be a non-negative safe integer",
    );
  }

  const cacheKey = [
    KEY_PREFIX,
    getEnvironmentNamespace(),
    SCHEMA_VERSION,
    schema,
    resource,
    identifier,
    `g${generation}`,
  ].join(":");

  if (cacheKey.length > MAX_KEY_LENGTH) {
    throw new Error("Cache key exceeds maximum length");
  }

  return cacheKey;
}

export function assertTtl(ttlSeconds: number): void {
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    ttlSeconds > MAX_TTL_SECONDS
  ) {
    throw new Error(
      `Cache TTL must be a positive integer no greater than ${MAX_TTL_SECONDS} seconds`,
    );
  }
}

function reportCacheFailure(
  operation: CacheOperation,
  reporter: CacheFailureReporter,
): CacheUnavailableError {
  try {
    // The diagnostic receives only a fixed operation label.
    // Never log raw Redis errors, URLs, tokens, or cached values.
    reporter(operation);
  } catch {
    // A failing diagnostic must not mask the cache failure.
  }

  return new CacheUnavailableError(operation);
}

/**
 * Internal dependency-injection seam.
 *
 * Used by deterministic failure-path tests. Do not re-export this
 * factory from the application-facing SDK entry point.
 */
export function createCacheOperations(
  adapter: CacheRedisAdapter,
  reporter: CacheFailureReporter = (operation) => {
    console.error(`Redis cache ${operation} failed`);
  },
) {
  async function cacheGet<T>(
    key: CacheKey,
  ): Promise<T | null> {
    const redisKey = buildCacheKey(key);

    try {
      // Normalize an undefined adapter result to the cache-miss contract.
      return (await adapter.get<T>(redisKey)) ?? null;
    } catch {
      throw reportCacheFailure("read", reporter);
    }
  }

  async function cacheSet<T>(
    key: CacheKey,
    value: T,
    ttlSeconds: number,
  ): Promise<void> {
    const redisKey = buildCacheKey(key);
    assertTtl(ttlSeconds);

    if (value === null || value === undefined) {
      throw new Error("Cache value must not be null or undefined");
    }

    try {
      await adapter.set(redisKey, value, ttlSeconds);
    } catch {
      throw reportCacheFailure("write", reporter);
    }
  }

  async function cacheDelete(
    key: CacheKey,
  ): Promise<void> {
    const redisKey = buildCacheKey(key);

    try {
      await adapter.delete(redisKey);
    } catch {
      // Invalidation failures propagate; never report false success.
      throw reportCacheFailure("delete", reporter);
    }
  }

  async function cacheGetOrSet<T>(
    key: CacheKey,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    // Reject invalid inputs before Redis or PostgreSQL work.
    buildCacheKey(key);
    assertTtl(ttlSeconds);

    let cached: T | null;

    try {
      cached = await cacheGet<T>(key);
    } catch (error: unknown) {
      if (!(error instanceof CacheUnavailableError)) {
        throw error;
      }

      // Redis read failed: explicitly fall back to the source.
      cached = null;
    }

    if (cached !== null) {
      return cached;
    }

    // PostgreSQL/application errors are deliberately not caught.
    const value = await fetcher();

    // Do not cache empty results.
    if (value === null || value === undefined) {
      return value;
    }

    try {
      await cacheSet(key, value, ttlSeconds);
    } catch (error: unknown) {
      if (!(error instanceof CacheUnavailableError)) {
        throw error;
      }

      // The fetch succeeded. The safe write-failure diagnostic was
      // emitted by cacheSet(); return the authoritative source result.
    }

    return value;
  }

  return {
    cacheGet,
    cacheSet,
    cacheDelete,
    cacheGetOrSet,
  };
}

// Production adapter: uses the existing shared Upstash REST wrapper.
// The raw Redis client remains private in redis.ts.
const productionCache = createCacheOperations({
  get: <T>(key: string) => redisGet<T>(key),

  set: <T>(
    key: string,
    value: T,
    ttlSeconds: number,
  ) => redisSet(key, value, ttlSeconds),

  delete: (key: string) => redisDelete(key),
});

// Internal SDK operations. Do not re-export these from the public
// application-facing SDK entry point.
export const cacheGet = productionCache.cacheGet;
export const cacheSet = productionCache.cacheSet;
export const cacheDelete = productionCache.cacheDelete;
export const cacheGetOrSet = productionCache.cacheGetOrSet;