import { resolveActorContext } from "./actor-context";
import { withActorTx, withSystemTx } from "./pool";
import { invalidateAnalyticsRefresh, PostCommitCacheInvalidationError } from "./cache-invalidation-policy";

export type AnalyticsRefreshResult = { status: string; views?: Record<string, string> };

export async function refreshAnalyticsAsAdmin(actorUserId: string, requestId: string, force = false): Promise<AnalyticsRefreshResult> {
  if (!/^[0-9a-f-]{36}$/i.test(actorUserId) || typeof requestId !== "string" || !requestId.trim() || requestId.length > 100 || typeof force !== "boolean") throw new TypeError("Invalid analytics refresh input.");
  const result = await withActorTx({ actorUserId: actorUserId.toLowerCase(), requestId }, async tx => {
    const actor = await resolveActorContext(tx, actorUserId);
    if (actor.role !== "AICTE_SUPER_ADMIN") throw new Error("Analytics refresh is restricted.");
    const result = await tx.query<{ result: AnalyticsRefreshResult }>("SELECT analytics.refresh_all($1) AS result", [force]);
    if (!result.rows[0]) throw new Error("Analytics refresh returned no result.");
    return result.rows[0].result;
  });
  if (result.status === "DONE" && Object.values(result.views ?? {}).includes("OK")) {
    try { await invalidateAnalyticsRefresh(); }
    catch (cause) { throw new PostCommitCacheInvalidationError("Analytics refresh committed, but cache invalidation failed; cached analytics may remain stale until their TTL expires.", cause); }
  }
  return result;
}

export async function refreshAnalyticsAsSystem(): Promise<AnalyticsRefreshResult> {
  const result = await withSystemTx(async tx => {
    const result = await tx.query<{ result: AnalyticsRefreshResult }>("SELECT analytics.refresh_all(FALSE) AS result");
    if (!result.rows[0]) throw new Error("Analytics refresh returned no result.");
    return result.rows[0].result;
  });
  if (result.status === "DONE" && Object.values(result.views ?? {}).includes("OK")) {
    try { await invalidateAnalyticsRefresh(); }
    catch (cause) { throw new PostCommitCacheInvalidationError("Analytics refresh committed, but cache invalidation failed; cached analytics may remain stale until their TTL expires.", cause); }
  }
  return result;
}
