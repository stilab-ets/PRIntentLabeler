import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL est requis pour exécuter les migrations.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});

try {
  const migration = await readFile(
    resolve("db/migrations/001_llm_configuration.sql"),
    "utf8",
  );
  await pool.query(migration);
  console.log("Migration 001_llm_configuration appliquée.");
} finally {
  await pool.end();
}
