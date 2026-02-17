/**
 * Allowlist for deterministic QA shell commands.
 * Only permits npm test and npm run lint.
 */

// ─── src/lib/execution/qaAllowlist.ts ───────────────────────────────────────

const ALLOWED: Array<{ command: string; args: string[] }> = [
  { command: "npm", args: ["test"] },
  { command: "npm", args: ["run", "lint"] },
];

export function isAllowedCommand(command: string, args: string[]): boolean {
  const cmd = String(command).trim().toLowerCase();
  const normalizedArgs = args.map((a) => String(a).trim());
  for (const a of ALLOWED) {
    if (a.command.toLowerCase() === cmd && a.args.length === normalizedArgs.length) {
      if (a.args.every((v, i) => v === normalizedArgs[i])) return true;
    }
  }
  return false;
}
