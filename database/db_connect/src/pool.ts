import { randomUUID } from "node:crypto";
import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { env } from "./env";

const POOL_MAX = 10;
const CONNECTION_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 30_000;
const STATEMENT_TIMEOUT_MS = 10_000;

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: POOL_MAX,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  statement_timeout: STATEMENT_TIMEOUT_MS,
  application_name: "backend-sdk",
});

pool.on("error", (error: Error & { code?: string }) => {
  console.error("Unexpected idle PostgreSQL client error", {
    name: error.name,
    code: error.code,
  });
});

export interface DbTx {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

export interface ActorTxContext {
  actorUserId: string;
  requestId?: string;
}

type TxCallback<T> = (tx: DbTx) => Promise<T>;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (typeof value !== "string" || !UUID_REGEX.test(value)) {
    throw new Error(`Invalid UUID: ${field}`);
  }
}

function createRequestId(value?: string): string {
  const id = value ?? randomUUID();

  if (
    typeof id !== "string" ||
    id.trim().length === 0 ||
    id.length > 100
  ) {
    throw new Error("Invalid requestId");
  }

  return id;
}

let shutdownPromise: Promise<void> | undefined;

async function runTransaction<T>(
  context:
    | {
        kind: "actor";
        actorUserId: string;
        requestId: string;
      }
    | {
        kind: "system";
        requestId: string;
      },
  callback: TxCallback<T>,
): Promise<T> {
  if (shutdownPromise) {
    throw new Error("Database pool is shutting down");
  }

  const client: PoolClient = await pool.connect();

  let transactionOpen = false;
  let discardClient: Error | undefined;

  const tx: DbTx = {
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: unknown[],
    ): Promise<QueryResult<R>> {
      return client.query<R>(text, values);
    },
  };

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    await client.query("SET LOCAL ROLE service_role");

    if (context.kind === "actor") {
      await client.query(
        `SELECT
           set_config('app.actor_user_id', $1, true),
           set_config('app.request_id', $2, true)`,
        [context.actorUserId, context.requestId],
      );
    } else {
      // Inspect the connection before setting this transaction's context.
      // NULL and empty/whitespace-only custom settings are accepted.
      const previous = await client.query<{
        actor_user_id: string | null;
        request_id: string | null;
      }>(`
        SELECT
          NULLIF(
            btrim(current_setting('app.actor_user_id', true)),
            ''
          ) AS actor_user_id,
          NULLIF(
            btrim(current_setting('app.request_id', true)),
            ''
          ) AS request_id
      `);

      const priorContext = previous.rows[0];

      if (
        !priorContext ||
        priorContext.actor_user_id !== null ||
        priorContext.request_id !== null
      ) {
        throw new Error(
          "Leaked actor/request context detected before system transaction initialization",
        );
      }

      await client.query(
        `SELECT
           set_config('app.actor_user_id', '', true),
           set_config('app.request_id', $1, true)`,
        [context.requestId],
      );
    }


    const result = await callback(tx);

    const commitResult = await client.query("COMMIT");

    // PostgreSQL can return the command tag "ROLLBACK" when COMMIT
    // is issued for a transaction already marked as aborted.
    transactionOpen = false;

    if (commitResult.command !== "COMMIT") {
    throw new Error(
        `Transaction was not committed; PostgreSQL returned command: ${
        commitResult.command || "unknown"
        }`,
    );
    }

    return result;

  } catch (error: unknown) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
        transactionOpen = false;
      } catch (rollbackError: unknown) {
        discardClient =
          rollbackError instanceof Error
            ? rollbackError
            : new Error("Rollback failed");

        console.error("PostgreSQL rollback failed; discarding client", {
          name: discardClient.name,
          code: (discardClient as Error & { code?: string }).code,
        });
      }
    }

    throw error;
  } finally {
    try {
      client.release(discardClient);
    } catch (releaseError: unknown) {
      console.error("PostgreSQL client release failed", {
        name:
          releaseError instanceof Error
            ? releaseError.name
            : "UnknownError",
      });
    }
  }
}

export function withActorTx<T>(
  context: ActorTxContext,
  callback: TxCallback<T>,
): Promise<T> {
  assertUuid(context.actorUserId, "actorUserId");

  return runTransaction(
    {
      kind: "actor",
      actorUserId: context.actorUserId,
      requestId: createRequestId(context.requestId),
    },
    callback,
  );
}

export function withSystemTx<T>(
  callback: TxCallback<T>,
  requestId?: string,
): Promise<T> {
  return runTransaction(
    {
      kind: "system",
      requestId: createRequestId(requestId),
    },
    callback,
  );
}

export function closePool(): Promise<void> {
  shutdownPromise ??= pool.end();
  return shutdownPromise;
}

/**
 * Internal connectivity probe.
 * Does not expose the pool or accept caller-supplied SQL.
 */
export async function checkDatabaseConnection(): Promise<void> {
  await pool.query("SELECT 1");
}
