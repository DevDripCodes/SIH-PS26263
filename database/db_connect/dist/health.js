"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDatabaseHealth = checkDatabaseHealth;
const pool_1 = require("./pool");
async function checkDatabaseHealth() {
    try {
        await (0, pool_1.checkDatabaseConnection)();
        return { status: "healthy" };
    }
    catch {
        return { status: "unhealthy" };
    }
}
