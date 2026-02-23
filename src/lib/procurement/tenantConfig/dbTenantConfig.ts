/**
 * DB-backed tenant config storage. Used when PERSISTENCE_DRIVER=db.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { procurementTenantConfigs } from "../../db/schema.js";
import type { TenantConfigStorage } from "./types.js";
import type { TenantProcurementConfig } from "../types.js";

export function createDbTenantConfigStorage(): TenantConfigStorage {
  return {
    async getTenantConfig(tenantId: string): Promise<TenantProcurementConfig | null> {
      try {
        const db = getDb();
        const rows = await db
          .select()
          .from(procurementTenantConfigs)
          .where(eq(procurementTenantConfigs.tenantId, tenantId));
        if (rows.length === 0) return null;
        const c = rows[0].config as TenantProcurementConfig | Record<string, unknown>;
        if (c && typeof c === "object" && "tenantId" in c) return c as TenantProcurementConfig;
        return { ...(c && typeof c === "object" ? c : {}), tenantId } as TenantProcurementConfig;
      } catch (e) {
        console.warn("[Procurement] Failed to load tenant config (db):", e instanceof Error ? e.message : e);
        return null;
      }
    },
    async setTenantConfig(config: TenantProcurementConfig): Promise<void> {
      const db = getDb();
      const now = new Date();
      const toStore = {
        ...config,
        updatedAtISO: now.toISOString(),
      };
      await db
        .insert(procurementTenantConfigs)
        .values({
          tenantId: config.tenantId,
          config: toStore as unknown as Record<string, unknown>,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: procurementTenantConfigs.tenantId,
          set: {
            config: toStore as unknown as Record<string, unknown>,
            updatedAt: now,
          },
        });
    },
  };
}
