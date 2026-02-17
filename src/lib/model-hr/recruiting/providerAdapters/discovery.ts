/**
 * Discover provider adapters based on files present in config directory.
 * - models.<provider>.json -> JSONConfigAdapter
 * - models.<provider>.remote.json -> RemoteStubAdapter (optional)
 */

import { readdir } from "fs/promises";
import { join } from "path";
import { createJSONConfigAdapter } from "./jsonConfigAdapter.js";
import { createRemoteStubAdapter } from "./remoteStubAdapter.js";
import type { ProviderAdapter } from "./types.js";

const CONFIG_PREFIX = "models.";
const CONFIG_SUFFIX = ".json";
const REMOTE_SUFFIX = ".remote.json";

function extractProviderFromFilename(filename: string): string | null {
  if (!filename.startsWith(CONFIG_PREFIX) || !filename.endsWith(CONFIG_SUFFIX)) {
    return null;
  }
  const middle = filename.slice(CONFIG_PREFIX.length, -CONFIG_SUFFIX.length);
  if (!middle || middle.includes(".")) return null;
  return middle;
}

function isRemoteConfig(filename: string): boolean {
  return filename.startsWith(CONFIG_PREFIX) && filename.endsWith(REMOTE_SUFFIX);
}

function extractProviderFromRemoteFilename(filename: string): string | null {
  if (!isRemoteConfig(filename)) return null;
  const middle = filename.slice(CONFIG_PREFIX.length, -REMOTE_SUFFIX.length);
  if (!middle || middle.includes(".")) return null;
  return middle;
}

/**
 * Discover adapters from config directory.
 * For each provider: JSONConfigAdapter if models.<provider>.json exists;
 * RemoteStubAdapter if models.<provider>.remote.json exists.
 */
export async function discoverAdapters(configDir: string): Promise<ProviderAdapter[]> {
  const adapters: ProviderAdapter[] = [];
  const providersWithJson = new Set<string>();
  const providersWithRemote = new Set<string>();

  let files: string[];
  try {
    files = await readdir(configDir);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return [];
    throw err;
  }

  for (const f of files) {
    const provider = extractProviderFromFilename(f);
    if (provider && !f.includes(".remote.")) {
      providersWithJson.add(provider);
    }
    const remoteProvider = extractProviderFromRemoteFilename(f);
    if (remoteProvider) {
      providersWithRemote.add(remoteProvider);
    }
  }

  for (const p of providersWithJson) {
    adapters.push(createJSONConfigAdapter(p, configDir));
  }
  for (const p of providersWithRemote) {
    adapters.push(createRemoteStubAdapter(p, configDir));
  }

  return adapters;
}
