import { checkDatabaseConnection } from "./pool";
export type DatabaseHealthResult = {
  status: "healthy" | "unhealthy";
};

export async function checkDatabaseHealth(): Promise<DatabaseHealthResult> {
  try {
    await checkDatabaseConnection();
    return { status: "healthy" };
  } catch {
    return { status: "unhealthy" };
  }
}