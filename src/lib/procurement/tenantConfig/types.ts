/**
 * Tenant config storage types. Non-secret only.
 */

import type { TenantProcurementConfig } from "../types.js";

export interface TenantConfigStorage {
  getTenantConfig(tenantId: string): Promise<TenantProcurementConfig | null>;
  setTenantConfig(config: TenantProcurementConfig): Promise<void>;
}
