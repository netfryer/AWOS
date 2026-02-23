/**
 * Database connection and client. Uses DATABASE_URL.
 * Lazy init: only connects when first used.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is required when PERSISTENCE_DRIVER=db");
    }
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}
