// How long run-all.mjs lets one spec run before killing its process tree. The default only fires on a genuine
// hang. A hosted CI runner is several times slower than a developer machine, so it may raise the ceiling with
// VAULTSPEND_E2E_SPEC_TIMEOUT_MS; the value is bounded so the guard can never be disabled by accident.

export const DEFAULT_SPEC_TIMEOUT_MS = 60_000;
const MAX_SPEC_TIMEOUT_MS = 600_000;

export function resolveSpecTimeout(env = process.env) {
  const raw = env.VAULTSPEND_E2E_SPEC_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_SPEC_TIMEOUT_MS;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < DEFAULT_SPEC_TIMEOUT_MS || value > MAX_SPEC_TIMEOUT_MS) {
    throw new Error(`VAULTSPEND_E2E_SPEC_TIMEOUT_MS must be a whole number of milliseconds from ${DEFAULT_SPEC_TIMEOUT_MS} to ${MAX_SPEC_TIMEOUT_MS}, got "${raw}"`);
  }
  return value;
}
