import { type QueryResult, type QueryResultRow } from "pg";
export interface DbTx {
    query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}
export interface ActorTxContext {
    actorUserId: string;
    requestId?: string;
}
type TxCallback<T> = (tx: DbTx) => Promise<T>;
export declare function withActorTx<T>(context: ActorTxContext, callback: TxCallback<T>): Promise<T>;
export declare function withSystemTx<T>(callback: TxCallback<T>, requestId?: string): Promise<T>;
export declare function closePool(): Promise<void>;
/**
 * Internal connectivity probe.
 * Does not expose the pool or accept caller-supplied SQL.
 */
export declare function checkDatabaseConnection(): Promise<void>;
export {};
