"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const NODE_ENV = process.env.NODE_ENV ?? "development";
if (!["development", "test", "production"].includes(NODE_ENV)) {
    throw new Error("Invalid NODE_ENV");
}
if (!DATABASE_URL) {
    throw new Error("Missing required environment variable: DATABASE_URL");
}
if (!UPSTASH_REDIS_REST_URL) {
    throw new Error("Missing required environment variable: UPSTASH_REDIS_REST_URL");
}
if (!UPSTASH_REDIS_REST_TOKEN) {
    throw new Error("Missing required environment variable: UPSTASH_REDIS_REST_TOKEN");
}
exports.env = {
    DATABASE_URL,
    UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN,
    NODE_ENV
};
