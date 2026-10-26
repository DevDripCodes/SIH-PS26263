"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheGetOrSet = exports.cacheDelete = exports.cacheSet = exports.cacheGet = exports.CacheUnavailableError = void 0;
exports.buildCacheKey = buildCacheKey;
exports.assertTtl = assertTtl;
exports.createCacheOperations = createCacheOperations;
const redis_1 = require("./redis");
const env_1 = require("./env");
const KEY_PREFIX = "sih";
const SCHEMA_VERSION = "v1";
const MAX_KEY_LENGTH = 512;
const MAX_SEGMENT_LENGTH = 128;
const MAX_TTL_SECONDS = 86_400;
const ENV_NAMESPACE = {
    development: "dev",
    test: "test",
    production: "prod",
};
class CacheUnavailableError extends Error {
    constructor(operation) {
        super(`Cache ${operation} unavailable`);
        this.name = "CacheUnavailableError";
    }
}
exports.CacheUnavailableError = CacheUnavailableError;
function getEnvironmentNamespace() {
    const nodeEnv = env_1.env.NODE_ENV;
    const namespace = ENV_NAMESPACE[nodeEnv];
    if (!namespace) {
        throw new Error("Invalid cache environment");
    }
    return namespace;
}
function validateSegment(value, field, pattern) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length > MAX_SEGMENT_LENGTH ||
        !pattern.test(value)) {
        throw new Error(`Invalid cache key ${field}`);
    }
}
function buildCacheKey(key) {
    if (!key || typeof key !== "object" || Array.isArray(key)) {
        throw new Error("Invalid cache key");
    }
    const { schema, resource, identifier, generation } = key;
    const allowedSchemas = [
        "core",
        "master",
        "staging",
        "trust",
        "analytics",
    ];
    if (!allowedSchemas.includes(schema)) {
        throw new Error("Invalid cache schema");
    }
    validateSegment(resource, "resource", /^[a-z][a-z0-9_-]*$/);
    const isCollection = identifier === "all";
    const isUuid = typeof identifier === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    if (!isCollection && !isUuid) {
        throw new Error("Cache identifier must be a UUID or 'all'; sensitive identifier caching is disabled");
    }
    if (!Number.isSafeInteger(generation) || generation < 0) {
        throw new Error("Cache generation must be a non-negative safe integer");
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
function assertTtl(ttlSeconds) {
    if (!Number.isSafeInteger(ttlSeconds) ||
        ttlSeconds <= 0 ||
        ttlSeconds > MAX_TTL_SECONDS) {
        throw new Error(`Cache TTL must be a positive integer no greater than ${MAX_TTL_SECONDS} seconds`);
    }
}
function reportCacheFailure(operation, reporter) {
    try {
        // The diagnostic receives only a fixed operation label.
        // Never log raw Redis errors, URLs, tokens, or cached values.
        reporter(operation);
    }
    catch {
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
function createCacheOperations(adapter, reporter = (operation) => {
    console.error(`Redis cache ${operation} failed`);
}) {
    async function cacheGet(key) {
        const redisKey = buildCacheKey(key);
        try {
            // Normalize an undefined adapter result to the cache-miss contract.
            return (await adapter.get(redisKey)) ?? null;
        }
        catch {
            throw reportCacheFailure("read", reporter);
        }
    }
    async function cacheSet(key, value, ttlSeconds) {
        const redisKey = buildCacheKey(key);
        assertTtl(ttlSeconds);
        if (value === null || value === undefined) {
            throw new Error("Cache value must not be null or undefined");
        }
        try {
            await adapter.set(redisKey, value, ttlSeconds);
        }
        catch {
            throw reportCacheFailure("write", reporter);
        }
    }
    async function cacheDelete(key) {
        const redisKey = buildCacheKey(key);
        try {
            await adapter.delete(redisKey);
        }
        catch {
            // Invalidation failures propagate; never report false success.
            throw reportCacheFailure("delete", reporter);
        }
    }
    async function cacheGetOrSet(key, ttlSeconds, fetcher) {
        // Reject invalid inputs before Redis or PostgreSQL work.
        buildCacheKey(key);
        assertTtl(ttlSeconds);
        let cached;
        try {
            cached = await cacheGet(key);
        }
        catch (error) {
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
        }
        catch (error) {
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
    get: (key) => (0, redis_1.cacheGet)(key),
    set: (key, value, ttlSeconds) => (0, redis_1.cacheSet)(key, value, ttlSeconds),
    delete: (key) => (0, redis_1.cacheDelete)(key),
});
// Internal SDK operations. Do not re-export these from the public
// application-facing SDK entry point.
exports.cacheGet = productionCache.cacheGet;
exports.cacheSet = productionCache.cacheSet;
exports.cacheDelete = productionCache.cacheDelete;
exports.cacheGetOrSet = productionCache.cacheGetOrSet;
