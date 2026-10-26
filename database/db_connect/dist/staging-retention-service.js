"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.purgeBatchPii = purgeBatchPii;
const pool_1 = require("./pool");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Runs only the schema's eligibility-checked PII purge for an identified batch. */
async function purgeBatchPii(batchId) {
    if (!UUID.test(batchId))
        throw new TypeError("Batch ID must be a UUID.");
    return (0, pool_1.withSystemTx)(async (tx) => {
        const result = await tx.query("SELECT staging.purge_batch_pii($1::uuid) AS purged_rows", [batchId.toLowerCase()]);
        const count = Number(result.rows[0]?.purged_rows);
        if (!Number.isSafeInteger(count) || count < 0)
            throw new Error("Invalid staging purge result.");
        return count;
    });
}
