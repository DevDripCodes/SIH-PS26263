"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheGet = cacheGet;
exports.cacheSet = cacheSet;
exports.cacheDelete = cacheDelete;
exports.acquireLock = acquireLock;
exports.releaseLock = releaseLock;
exports.incrementVersion = incrementVersion;
exports.readCacheVersionCounter = readCacheVersionCounter;
exports.incrementCacheVersionCounters = incrementCacheVersionCounters;
exports.getCacheVersionCounterTtl = getCacheVersionCounterTtl;
exports.deleteCacheVersionCounters = deleteCacheVersionCounters;
exports.seedCacheVersionCounterForTesting = seedCacheVersionCounterForTesting;
const redis_1 = require("@upstash/redis");
const node_crypto_1 = require("node:crypto");
const env_1 = require("./env");
/**
 * Shared Upstash REST client.
 *
 * Keep this client private to the SDK infrastructure layer.
 * Do not export it or expose arbitrary command execution.
 */
const redis = new redis_1.Redis({
    url: env_1.env.UPSTASH_REDIS_REST_URL,
    token: env_1.env.UPSTASH_REDIS_REST_TOKEN,
});
const DEFAULT_CACHE_TTL_SECONDS = 300;
const MIN_TTL_SECONDS = 1;
const MAX_KEY_LENGTH = 512;
function assertKey(key) {
    if (typeof key !== "string" ||
        key.trim().length === 0 ||
        key.length > MAX_KEY_LENGTH) {
        throw new Error("Invalid Redis key");
    }
}
function assertTtl(ttlSeconds) {
    if (!Number.isSafeInteger(ttlSeconds) ||
        ttlSeconds < MIN_TTL_SECONDS) {
        throw new Error("Invalid Redis TTL");
    }
}
/**
 * Reads a JSON-compatible cached value.
 * Upstash handles JSON serialization/deserialization.
 */
async function cacheGet(key) {
    assertKey(key);
    return redis.get(key);
}
/**
 * Writes a cached value with a finite TTL.
 */
async function cacheSet(key, value, ttlSeconds = DEFAULT_CACHE_TTL_SECONDS) {
    assertKey(key);
    assertTtl(ttlSeconds);
    await redis.set(key, value, { ex: ttlSeconds });
}
/**
 * Deletes a cache entry.
 */
async function cacheDelete(key) {
    assertKey(key);
    await redis.del(key);
}
/**
 * Acquires a distributed lock if it does not already exist.
 *
 * Returns an opaque ownership token when acquired, or null if
 * another caller currently owns the lock.
 */
async function acquireLock(key, ttlSeconds) {
    assertKey(key);
    assertTtl(ttlSeconds);
    const ownershipToken = (0, node_crypto_1.randomUUID)();
    const result = await redis.set(key, ownershipToken, {
        ex: ttlSeconds,
        nx: true,
    });
    return result === "OK" ? ownershipToken : null;
}
/**
 * Releases a lock only if the caller still owns it.
 *
 * The comparison and deletion must be atomic. Never use DEL alone
 * to release a distributed lock.
 */
async function releaseLock(key, ownershipToken) {
    assertKey(key);
    if (typeof ownershipToken !== "string" ||
        ownershipToken.trim().length === 0) {
        throw new Error("Invalid lock ownership token");
    }
    const result = await redis.eval(`
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0
    `, [key], [ownershipToken]);
    return result === 1;
}
/**
 * Atomically increments a version counter.
 * Creates the counter with value 1 if it does not exist.
 */
async function incrementVersion(key) {
    assertKey(key);
    const results = await redis.pipeline().incr(key).exec();
    const version = results[0];
    if (typeof version !== "number" || !Number.isSafeInteger(version)) {
        throw new Error("Redis version increment failed");
    }
    return version;
}
const CACHE_VERSION_KEY_REGEX = /^sih:(dev|test|prod):v1:(core|master|staging|trust|analytics):[a-z][a-z0-9_-]{0,127}:(?:all|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):version$/i;
function assertCacheVersionKey(key) {
    if (typeof key !== "string" ||
        key.length > 512 ||
        !CACHE_VERSION_KEY_REGEX.test(key)) {
        throw new Error("Invalid cache version counter key");
    }
}
function parseCounterValue(value) {
    let parsed;
    if (typeof value === "number") {
        parsed = value;
    }
    else if (typeof value === "string" &&
        /^(0|[1-9]\d*)$/.test(value)) {
        parsed = Number(value);
    }
    else {
        throw new Error("Invalid cache version counter value");
    }
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error("Cache version counter is outside the safe integer range");
    }
    return parsed;
}
/**
 * Reads a persistent version counter.
 * Returns null only when the counter genuinely does not exist.
 * Redis errors propagate.
 */
async function readCacheVersionCounter(key) {
    assertCacheVersionKey(key);
    const value = await redis.get(key);
    if (value === null) {
        return null;
    }
    return parseCounterValue(value);
}
/**
 * Atomically increments a set of version counters in one Redis transaction.
 * This function never assigns a TTL to counter keys.
 */
async function incrementCacheVersionCounters(keys) {
    if (keys.length === 0) {
        throw new Error("At least one cache version counter is required");
    }
    for (const key of keys) {
        assertCacheVersionKey(key);
    }
    if (new Set(keys).size !== keys.length) {
        throw new Error("Duplicate cache version counter keys");
    }
    const script = `
    -- Validate every existing counter before changing any counter.
    for i, key in ipairs(KEYS) do
      local value = redis.call("GET", key)

      if value ~= false then
        if not string.match(value, "^%d+$") then
          return redis.error_reply("INVALID_COUNTER_VALUE")
        end

        local number = tonumber(value)
        if not number or number >= 9007199254740991 then
          return redis.error_reply("COUNTER_OUT_OF_RANGE")
        end
      end
    end

    -- Validation succeeded for every key; now increment all counters.
    local results = {}
    for i, key in ipairs(KEYS) do
      results[i] = redis.call("INCR", key)
    end

    return results
  `;
    const result = await redis.eval(script, [...keys], []);
    if (!Array.isArray(result) ||
        result.length !== keys.length ||
        result.some((value) => typeof value !== "number" ||
            !Number.isSafeInteger(value) ||
            value < 1)) {
        throw new Error("Cache version transaction returned an invalid result");
    }
}
/**
 * Internal observability helper for integration tests.
 * Redis TTL returns -1 for an existing key with no expiration.
 */
async function getCacheVersionCounterTtl(key) {
    assertCacheVersionKey(key);
    const ttl = await redis.ttl(key);
    if (!Number.isInteger(ttl) || ttl < -2) {
        throw new Error("Invalid cache version TTL result");
    }
    return ttl;
}
/**
 * Deletes only validated version-counter keys.
 * Intended for test cleanup and controlled internal maintenance.
 */
async function deleteCacheVersionCounters(keys) {
    for (const key of keys) {
        assertCacheVersionKey(key);
    }
    for (const key of new Set(keys)) {
        await redis.del(key);
    }
}
async function seedCacheVersionCounterForTesting(key, value) {
    assertCacheVersionKey(key);
    await redis.set(key, value);
}
