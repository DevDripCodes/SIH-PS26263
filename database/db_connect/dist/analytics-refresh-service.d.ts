export type AnalyticsRefreshResult = {
    status: string;
    views?: Record<string, string>;
};
export declare function refreshAnalyticsAsAdmin(actorUserId: string, requestId: string, force?: boolean): Promise<AnalyticsRefreshResult>;
export declare function refreshAnalyticsAsSystem(): Promise<AnalyticsRefreshResult>;
