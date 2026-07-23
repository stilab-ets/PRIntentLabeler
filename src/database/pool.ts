import { Pool } from "pg";

let pool: Pool | undefined;

export function getDatabasePool(): Pool | null {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }

  return pool;
}
