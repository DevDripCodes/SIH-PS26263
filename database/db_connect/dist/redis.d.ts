/**
 * Reads a JSON-compatible cached value.
 * Upstash handles JSON serialization/deserialization.
 */
export declare function cacheGet<T>(key: string): Promise<T | null>;
/**
 * Writes a cached value with a finite TTL.
 */
export declare function cacheSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
/**
 * Deletes a cache entry.
 */
export declare function cacheDelete(key: string): Promise<void>;
/**
 * Acquires a distributed lock if it does not already exist.
 *
 * Returns an opaque ownership token when acquired, or null if
 * another caller currently owns the lock.
 */
export declare function acquireLock(key: string, ttlSeconds: number): Promise<string | null>;
/**
 * Releases a lock only if the caller still owns it.
 *
 * The comparison and deletion must be atomic. Never use DEL alone
 * to release a distributed lock.
 */
export declare function releaseLock(key: string, ownershipToken: string): Promise<boolean>;
/**
 * Atomically increments a version counter.
 * Creates the counter with value 1 if it does not exist.
 */
export declare function incrementVersion(key: string): Promise<number>;
/**
 * Reads a persistent version counter.
 * Returns null only when the counter genuinely does not exist.
 * Redis errors propagate.
 */
export declare function readCacheVersionCounter(key: string): Promise<number | null>;
/**
 * Atomically increments a set of version counters in one Redis transaction.
 * This function never assigns a TTL to counter keys.
 */
export declare function incrementCacheVersionCounters(keys: readonly string[]): Promise<void>;
/**
 * Internal observability helper for integration tests.
 * Redis TTL returns -1 for an existing key with no expiration.
 */
export declare function getCacheVersionCounterTtl(key: string): Promise<number>;
/**
 * Deletes only validated version-counter keys.
 * Intended for test cleanup and controlled internal maintenance.
 */
export declare function deleteCacheVersionCounters(keys: readonly string[]): Promise<void>;
export declare function seedCacheVersionCounterForTesting(key: string, value: string): Promise<void>;
