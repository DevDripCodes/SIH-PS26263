import { type CacheKey } from "./cache";
import { type CacheVersionNamespace } from "./cache-version";
/**
 * Internal dependency-injection seam for coordinating the existing cache
 * and cache-version abstractions. Do not re-export this factory from the
 * application-facing SDK entry point.
 */
export interface VersionedCacheDependencies {
    getCacheVersion: (namespace: CacheVersionNamespace) => Promise<number>;
    buildCacheKey: (key: CacheKey) => string;
    cacheGetOrSet: <T>(key: CacheKey, ttlSeconds: number, fetcher: () => Promise<T>) => Promise<T>;
    bumpCacheVersion: (...namespaces: CacheVersionNamespace[]) => Promise<unknown>;
}
export declare function createVersionedCacheOperations(dependencies: VersionedCacheDependencies): {
    getOrSetVersioned: <T>(namespace: CacheVersionNamespace, ttlSeconds: number, fetcher: () => Promise<T>) => Promise<T>;
    invalidateCacheNamespaces: (...namespaces: CacheVersionNamespace[]) => Promise<void>;
};
export declare const getOrSetVersioned: <T>(namespace: CacheVersionNamespace, ttlSeconds: number, fetcher: () => Promise<T>) => Promise<T>;
export declare const invalidateCacheNamespaces: (...namespaces: CacheVersionNamespace[]) => Promise<void>;
