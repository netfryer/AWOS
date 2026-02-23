/**
 * Persistence driver: db | file.
 * PERSISTENCE_DRIVER=db uses PostgreSQL; default is file for backward compatibility.
 */

export type PersistenceDriver = "db" | "file";

export function getPersistenceDriver(): PersistenceDriver {
  const v = process.env.PERSISTENCE_DRIVER?.toLowerCase();
  if (v === "db") return "db";
  return "file";
}
