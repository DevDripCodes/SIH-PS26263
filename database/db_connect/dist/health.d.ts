export type DatabaseHealthResult = {
    status: "healthy" | "unhealthy";
};
export declare function checkDatabaseHealth(): Promise<DatabaseHealthResult>;
