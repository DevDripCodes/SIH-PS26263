"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateCacheNamespaces = exports.getOrSetVersioned = void 0;
exports.createVersionedCacheOperations = createVersionedCacheOperations;
const cache_1 = require("./cache");
const cache_version_1 = require("./cache-version");
function sameNamespace(left, right) {
    return (left.schema === right.schema &&
        left.resource === right.resource &&
        left.identifier === right.identifier);
}
function createVersionedCacheOperations(dependencies) {
    async function getOrSetVersioned(namespace, ttlSeconds, fetcher) {
        // Validate all caller-controlled inputs before any Redis operation.
        // Reuse cache.ts validators rather than maintaining parallel rules.
        (0, cache_1.assertTtl)(ttlSeconds);
        // Probe with the widest valid generation so key-length validation cannot
        // be deferred until after the version-counter read.
        dependencies.buildCacheKey({
            ...namespace,
            generation: Number.MAX_SAFE_INTEGER,
        });
        // Do not catch this call: a failed version read must not become generation 0.
        const generation = await dependencies.getCacheVersion(namespace);
        const key = {
            ...namespace,
            generation,
        };
        // Validate the actual generation-specific key too (e.g. total key length).
        // cacheGetOrSet uses the same builder internally to perform the operation.
        dependencies.buildCacheKey(key);
        return dependencies.cacheGetOrSet(key, ttlSeconds, fetcher);
    }
    async function invalidateCacheNamespaces(...namespaces) {
        if (namespaces.length === 0) {
            throw new Error("At least one cache namespace is required");
        }
        const distinctNamespaces = [];
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
    getCacheVersion: cache_version_1.getCacheVersion,
    buildCacheKey: cache_1.buildCacheKey,
    cacheGetOrSet: cache_1.cacheGetOrSet,
    bumpCacheVersion: cache_version_1.bumpCacheVersion,
});
exports.getOrSetVersioned = productionOperations.getOrSetVersioned;
exports.invalidateCacheNamespaces = productionOperations.invalidateCacheNamespaces;
