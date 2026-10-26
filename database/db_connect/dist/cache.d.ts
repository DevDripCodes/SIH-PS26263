export type CacheSchema = "core" | "master" | "staging" | "trust" | "analytics";
export interface CacheKey {
    schema: CacheSchema;
    resource: string;
    identifier: string;
    generation: number;
}
export type CacheOperation = "read" | "write" | "delete";
export interface CacheRedisAdapter {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
    delete(key: string): Promise<void>;
}
export declare class CacheUnavailableError extends Error {
    constructor(operation: CacheOperation);
}
type CacheFailureReporter = (operation: CacheOperation) => void;
export declare function buildCacheKey(key: CacheKey): string;
export declare function assertTtl(ttlSeconds: number): void;
/**
 * Internal dependency-injection seam.
 *
 * Used by deterministic failure-path tests. Do not re-export this
 * factory from the application-facing SDK entry point.
 */
export declare function createCacheOperations(adapter: CacheRedisAdapter, reporter?: CacheFailureReporter): {
    cacheGet: <T>(key: CacheKey) => Promise<T | null>;
    cacheSet: <T>(key: CacheKey, value: T, ttlSeconds: number) => Promise<void>;
    cacheDelete: (key: CacheKey) => Promise<void>;
    cacheGetOrSet: <T>(key: CacheKey, ttlSeconds: number, fetcher: () => Promise<T>) => Promise<T>;
};
export declare const cacheGet: <T>(key: CacheKey) => Promise<T | null>;
export declare const cacheSet: <T>(key: CacheKey, value: T, ttlSeconds: number) => Promise<void>;
export declare const cacheDelete: (key: CacheKey) => Promise<void>;
export declare const cacheGetOrSet: <T>(key: CacheKey, ttlSeconds: number, fetcher: () => Promise<T>) => Promise<T>;
export {};
