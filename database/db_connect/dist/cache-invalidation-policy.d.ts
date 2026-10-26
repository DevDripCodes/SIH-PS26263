import type { CacheVersionNamespace } from "./cache-version";
type DomainMutation = "institution" | "program" | "intake" | "batch" | "promotion" | "credential" | "consent" | "verification";
export declare class PostCommitCacheInvalidationError extends Error {
    readonly committed = true;
    constructor(message: string, cause: unknown);
}
export declare function cacheNamespacesForMutation(mutation: DomainMutation, id: string): CacheVersionNamespace[];
export declare function invalidateForMutation(mutation: DomainMutation, id: string): Promise<void>;
export declare function invalidateCredentialChanges(...credentialIds: string[]): Promise<void>;
export declare function invalidateAnalyticsRefresh(): Promise<void>;
export {};
