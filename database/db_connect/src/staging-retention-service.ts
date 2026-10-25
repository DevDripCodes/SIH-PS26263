import { withSystemTx } from "./pool";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs only the schema's eligibility-checked PII purge for an identified batch. */
export async function purgeBatchPii(batchId: string): Promise<number> {
  if (!UUID.test(batchId)) throw new TypeError("Batch ID must be a UUID.");
  return withSystemTx(async tx => {
    const result = await tx.query<{ purged_rows: string | number }>("SELECT staging.purge_batch_pii($1::uuid) AS purged_rows", [batchId.toLowerCase()]);
    const count = Number(result.rows[0]?.purged_rows);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid staging purge result.");
    return count;
  });
}
