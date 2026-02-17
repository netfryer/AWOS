/**
 * JSONL logging. Appends one JSON line per event.
 */

import { mkdir, appendFile } from "fs/promises";
import { dirname } from "path";

const DEFAULT_LOG_PATH = "./runs/runs.jsonl";

/**
 * Ensures directory exists (mkdir -p), then appends one JSON line.
 */
export async function appendJsonl(
  path: string,
  event: unknown
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const line = JSON.stringify(event) + "\n";
  await appendFile(path, line);
}
