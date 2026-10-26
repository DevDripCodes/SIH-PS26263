import type { PoolClient } from "pg";
import { pool } from "./pool.js";

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Set the transaction-local actor read by trust.current_actor() and the audit triggers. */
export async function setActor(client: PoolClient, actorUserId: string | null, requestId?: string): Promise<void> {
  await client.query("SELECT set_config('app.actor_user_id', $1, true), set_config('app.request_id', $2, true)", [
    actorUserId ?? "",
    requestId ?? "",
  ]);
}

export function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}
