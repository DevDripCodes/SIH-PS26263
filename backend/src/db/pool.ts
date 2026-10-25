import pg from "pg";

// Staging tables are raw SQL (enums, composite FKs, RLS), so ingestion talks to
// Postgres directly through pg rather than the Prisma client.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("supabase.com") ? { rejectUnauthorized: false } : undefined,
  max: 10,
});
