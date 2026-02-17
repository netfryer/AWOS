/**
 * File-backed tenant config storage. Non-secret only.
 * Path: .data/procurement/tenants/<tenantId>.json
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { TenantConfigStorage } from "./types.js";
import type { TenantProcurementConfig } from "../types.js";

function getDataDir(): string {
  return process.env.PROCUREMENT_DATA_DIR ?? join(process.cwd(), ".data", "procurement");
}

export function createFileTenantConfigStorage(): TenantConfigStorage {
  return {
    async getTenantConfig(tenantId: string): Promise<TenantProcurementConfig | null> {
      try {
        const dir = join(getDataDir(), "tenants");
        const path = join(dir, `${tenantId}.json`);
        const raw = await readFile(path, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && "tenantId" in parsed) {
          return parsed as TenantProcurementConfig;
        }
        return null;
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return null;
        console.warn("[Procurement] Failed to load tenant config:", err.message);
        return null;
      }
    },
    async setTenantConfig(config: TenantProcurementConfig): Promise<void> {
      const dir = join(getDataDir(), "tenants");
      await mkdir(dir, { recursive: true });
      const path = join(dir, `${config.tenantId}.json`);
      const toWrite = {
        ...config,
        updatedAtISO: new Date().toISOString(),
      };
      await writeFile(path, JSON.stringify(toWrite, null, 2), "utf-8");
    },
  };
}
