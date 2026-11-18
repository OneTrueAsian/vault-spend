/** Opt-in bounded timing only. No transaction content, persistent storage or telemetry. */
type Sample = { stage: string; ms: number };
declare global { interface Window { __vaultTransactionPerf?: Sample[] } }
export function transactionPerf<T>(stage: string, run: () => T): T {
  if (typeof document === "undefined" || !document.documentElement.hasAttribute("data-vault-transaction-perf")) return run();
  const start = performance.now();
  try { return run(); } finally { recordTransactionPerf(stage, performance.now() - start); }
}
export function recordTransactionPerf(stage: string, ms = 0) {
  if (typeof document === "undefined" || !document.documentElement.hasAttribute("data-vault-transaction-perf")) return;
  const samples = window.__vaultTransactionPerf ??= [];
  samples.push({ stage, ms });
  if (samples.length > 256) samples.splice(0, samples.length - 256);
}
