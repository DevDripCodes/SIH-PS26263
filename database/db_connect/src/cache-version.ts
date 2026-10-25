
import type { CacheKey, CacheSchema } from "./cache";
import { env } from "./env";
import {
  incrementCacheVersionCounters,
  readCacheVersionCounter,
} from "./redis";

export type CacheVersionNamespace = Pick<
  CacheKey,
  "schema" | "resource" | "identifier"
>;

export interface CacheVersionRedisAdapter {
  readCounter(key: string): Promise<number | null>;
  incrementCounters(keys: readonly string[]): Promise<void>;
}

const KEY_PREFIX = "sih";
const SCHEMA_VERSION = "v1"; // Keep synchronized with cache.ts.
const MAX_KEY_LENGTH = 512;
const MAX_SEGMENT_LENGTH = 128;

const ENV_NAMESPACE = {
  development: "dev",
  test: "test",
  production: "prod",
} as const;

type Environment = keyof typeof ENV_NAMESPACE;

function getEnvironmentNamespace(): string {
  const nodeEnv = env.NODE_ENV as Environment;
  const namespace = ENV_NAMESPACE[nodeEnv];

  if (!namespace) {
    throw new Error("Invalid cache environment");
  }

  return namespace;
}

function validateResource(resource: string): void {
  if (
    typeof resource !== "string" ||
    resource.length === 0 ||
    resource.length > MAX_SEGMENT_LENGTH ||
    !/^[a-z][a-z0-9_-]*$/.test(resource)
  ) {
    throw new Error("Invalid cache version resource");
  }
}

function validateIdentifier(identifier: string): void {
  const isCollection = identifier === "all";

  const isUuid =
    typeof identifier === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      identifier,
    );

  if (!isCollection && !isUuid) {
    throw new Error(
      "Cache version identifier must be a UUID or 'all'; sensitive identifier caching is disabled",
    );
  }
}

function buildVersionCounterKey(
  namespace: CacheVersionNamespace,
): string {
  if (
    !namespace ||
    typeof namespace !== "object" ||
    Array.isArray(namespace)
  ) {
    throw new Error("Invalid cache version namespace");
  }

  const { schema, resource, identifier } = namespace;

  const allowedSchemas: readonly CacheSchema[] = [
    "core",
    "master",
    "staging",
    "trust",
    "analytics",
  ];

  if (!allowedSchemas.includes(schema)) {
    throw new Error("Invalid cache version schema");
  }

  validateResource(resource);
  validateIdentifier(identifier);

  const key = [
    KEY_PREFIX,
    getEnvironmentNamespace(),
    SCHEMA_VERSION,
    schema,
    resource,
    identifier,
    "version",
  ].join(":");

  if (key.length > MAX_KEY_LENGTH) {
    throw new Error("Cache version key exceeds maximum length");
  }

  return key;
}

/**
 * Internal dependency-injection seam for deterministic failure tests.
 * Do not re-export this factory from the application-facing SDK entry point.
 */
export function createCacheVersionOperations(
  adapter: CacheVersionRedisAdapter,
) {
  async function getCacheVersion(
    namespace: CacheVersionNamespace,
  ): Promise<number> {
    const key = buildVersionCounterKey(namespace);

    // Only a genuine null/missing result becomes generation zero.
    // Redis and invalid-counter errors propagate.
    const version = await adapter.readCounter(key);

    if (version === null) {
      return 0;
    }

    if (!Number.isSafeInteger(version) || version < 0) {
      throw new Error("Invalid cache version counter value");
    }

    return version;
  }

  async function bumpCacheVersion(
    ...namespaces: CacheVersionNamespace[]
  ): Promise<void> {
    if (namespaces.length === 0) {
      throw new Error(
        "At least one cache version namespace is required",
      );
    }

    // Validate every namespace before submitting any Redis command.
    const keys = [
      ...new Set(namespaces.map(buildVersionCounterKey)),
    ];

    // One atomic multi-key transaction; failures propagate to the caller.
    await adapter.incrementCounters(keys);
  }

  return {
    getCacheVersion,
    bumpCacheVersion,
  };
}

const productionOperations = createCacheVersionOperations({
  readCounter: readCacheVersionCounter,
  incrementCounters: incrementCacheVersionCounters,
});

export const getCacheVersion =
  productionOperations.getCacheVersion;

export const bumpCacheVersion =
  productionOperations.bumpCacheVersion;
