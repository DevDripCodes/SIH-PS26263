import {
  assertTtl,
  buildCacheKey,
  cacheGetOrSet,
  type CacheKey,
} from "./cache";
import {
  bumpCacheVersion,
  getCacheVersion,
  type CacheVersionNamespace,
} from "./cache-version";

/**
 * Internal dependency-injection seam for coordinating the existing cache
 * and cache-version abstractions. Do not re-export this factory from the
 * application-facing SDK entry point.
 */
export interface VersionedCacheDependencies {
  getCacheVersion: (
    namespace: CacheVersionNamespace,
  ) => Promise<number>;
  buildCacheKey: (key: CacheKey) => string;
  cacheGetOrSet: <T>(
    key: CacheKey,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ) => Promise<T>;
  bumpCacheVersion: (
    ...namespaces: CacheVersionNamespace[]
  ) => Promise<unknown>;
}

function sameNamespace(
  left: CacheVersionNamespace,
  right: CacheVersionNamespace,
): boolean {
  return (
    left.schema === right.schema &&
    left.resource === right.resource &&
    left.identifier === right.identifier
  );
}

export function createVersionedCacheOperations(
  dependencies: VersionedCacheDependencies,
) {
  async function getOrSetVersioned<T>(
    namespace: CacheVersionNamespace,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    // Validate all caller-controlled inputs before any Redis operation.
    // Reuse cache.ts validators rather than maintaining parallel rules.
    assertTtl(ttlSeconds);
    // Probe with the widest valid generation so key-length validation cannot
    // be deferred until after the version-counter read.
    dependencies.buildCacheKey({
      ...namespace,
      generation: Number.MAX_SAFE_INTEGER,
    });

    // Do not catch this call: a failed version read must not become generation 0.
    const generation = await dependencies.getCacheVersion(namespace);

    const key: CacheKey = {
      ...namespace,
      generation,
    };

    // Validate the actual generation-specific key too (e.g. total key length).
    // cacheGetOrSet uses the same builder internally to perform the operation.
    dependencies.buildCacheKey(key);

    return dependencies.cacheGetOrSet(key, ttlSeconds, fetcher);
  }

  async function invalidateCacheNamespaces(
    ...namespaces: CacheVersionNamespace[]
  ): Promise<void> {
    if (namespaces.length === 0) {
      throw new Error("At least one cache namespace is required");
    }

    const distinctNamespaces: CacheVersionNamespace[] = [];

    for (const namespace of namespaces) {
      // Reuse the existing builder, checking against the widest valid
      // generation so the namespace remains valid as its counter advances.
      dependencies.buildCacheKey({
        ...namespace,
        generation: Number.MAX_SAFE_INTEGER,
      });

      if (!distinctNamespaces.some((item) => sameNamespace(item, namespace))) {
        distinctNamespaces.push(namespace);
      }
    }

    // One delegated operation for the full set. Errors deliberately propagate.
    await dependencies.bumpCacheVersion(...distinctNamespaces);
  }

  return {
    getOrSetVersioned,
    invalidateCacheNamespaces,
  };
}

const productionOperations = createVersionedCacheOperations({
  getCacheVersion,
  buildCacheKey,
  cacheGetOrSet,
  bumpCacheVersion,
});

export const getOrSetVersioned = productionOperations.getOrSetVersioned;
export const invalidateCacheNamespaces =
  productionOperations.invalidateCacheNamespaces;
