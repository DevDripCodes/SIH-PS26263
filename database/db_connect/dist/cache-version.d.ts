import type { CacheKey } from "./cache";
export type CacheVersionNamespace = Pick<CacheKey, "schema" | "resource" | "identifier">;
export interface CacheVersionRedisAdapter {
    readCounter(key: string): Promise<number | null>;
    incrementCounters(keys: readonly string[]): Promise<void>;
}
/**
 * Internal dependency-injection seam for deterministic failure tests.
 * Do not re-export this factory from the application-facing SDK entry point.
 */
export declare function createCacheVersionOperations(adapter: CacheVersionRedisAdapter): {
    getCacheVersion: (namespace: CacheVersionNamespace) => Promise<number>;
    bumpCacheVersion: (...namespaces: CacheVersionNamespace[]) => Promise<void>;
};
export declare const getCacheVersion: (namespace: CacheVersionNamespace) => Promise<number>;
export declare const bumpCacheVersion: (...namespaces: CacheVersionNamespace[]) => Promise<void>;
