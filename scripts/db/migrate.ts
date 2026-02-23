/**
 * Run migrations in order. Requires DATABASE_URL.
 * Usage: DATABASE_URL=postgresql://... tsx scripts/db/migrate.ts
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

async function main() {
  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_migrations" (
        "name" text PRIMARY KEY,
        "applied_at" timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    for (const f of sqlFiles) {
      const { rows } = await client.query(
        "SELECT 1 FROM _migrations WHERE name = $1",
        [f]
      );
      if (rows.length > 0) {
        console.log(`Migration ${f} already applied, skipping.`);
        continue;
      }
      const sqlPath = join(MIGRATIONS_DIR, f);
      const sql = await readFile(sqlPath, "utf-8");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [f]);
      console.log(`Migration ${f} applied.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
