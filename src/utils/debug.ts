/**
 * Controlled debug logging for estimation flow.
 * Set DEBUG_ESTIMATION=true to enable.
 */

export const DEBUG_ESTIMATION = process.env.DEBUG_ESTIMATION === "true";

export function debugLog(...args: unknown[]): void {
  if (DEBUG_ESTIMATION) {
    console.log(...args);
  }
}
