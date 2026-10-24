// The app's own "@tauri-apps/api/core" (vite.config.ts aliases the package name to this file). It is the real module plus one
// duty: after a successful command that can change an investment illustration, say so, so an open Ask the Vault result retires
// at once. Tauri's own bridge object is read-only, so this is the one place every call passes through.
import { invoke as nativeInvoke } from "../node_modules/@tauri-apps/api/core.js";
import type { InvokeArgs, InvokeOptions } from "../node_modules/@tauri-apps/api/core.js";
import { RELEVANT_WRITE_COMMANDS, notifyDataWrite } from "./askVault/dataWriteEvents";
import { beginStageSample, finishStageSample, stageProblems, traceInvoke, traceValidate, type NativeStageSnapshot } from "./askVault/retirementStageTrace";

export * from "../node_modules/@tauri-apps/api/core.js";

export async function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  const result = import.meta.env.TAURI_ENV_DEBUG === "true" || import.meta.env.TAURI_ENV_DEBUG === true
    ? await traceInvoke(cmd, () => nativeInvoke<T>(cmd, args, options))
    : await nativeInvoke<T>(cmd, args, options);
  if (RELEVANT_WRITE_COMMANDS.has(cmd)) notifyDataWrite(cmd);
  return result;
}

// A compiled fixture may exercise the production write/notification path. Debug mode alone is never permission;
// the native fixture boundary is checked before exposure and again before each narrowly allowed operation.
// This entire branch is eliminated when TAURI_ENV_DEBUG is false in a release build.
if (import.meta.env.TAURI_ENV_DEBUG === "true" || import.meta.env.TAURI_ENV_DEBUG === true) {
  let stageOwner: { expectedGeneration: number; expectedSessionRevision: number } | null = null;
  const stageBridge = Object.freeze({
    async begin(sample: number) {
      if (stageOwner) throw new Error("Diagnostic sample already active");
      const context = await nativeInvoke<{ generation: number; sessionRevision: number }>("get_transaction_context");
      const owner = { expectedGeneration: context.generation, expectedSessionRevision: context.sessionRevision };
      await nativeInvoke("debug_retirement_stage_begin", { ...owner, sample });
      beginStageSample(sample); stageOwner = owner;
    },
    async drain() {
      const owner = stageOwner;
      if (!owner) throw new Error("No diagnostic sample");
      const js = finishStageSample();
      stageOwner = null;
      const native = await nativeInvoke<NativeStageSnapshot>("debug_retirement_stage_drain", owner);
      return { js, native };
    },
    validate: traceValidate,
    problems: stageProblems,
  });
  const allowed = new Set(["set_investment_plan", "set_profile_ui_state", "get_transaction_context", "get_ask_vault_retirement_accounts", "get_ask_vault_retirement_context"]);
  async function fixtureInvoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
    if (!allowed.has(cmd)) throw new Error("This fixture operation is not allowed.");
    if (await nativeInvoke("debug_retirement_fixture_allowed") !== true) throw new Error("The disposable fixture is no longer available.");
    return invoke<T>(cmd, args, options);
  }
  void nativeInvoke("debug_retirement_fixture_allowed").then(ready => {
    if (ready === true) {
      (globalThis as { __vaultspendDebug?: { invoke: typeof invoke } }).__vaultspendDebug = Object.freeze({ invoke: fixtureInvoke });
      (globalThis as { __vaultspendStageTrace?: typeof stageBridge }).__vaultspendStageTrace = stageBridge;
    }
  }).catch(() => { /* No fixture or unsupported command: expose nothing. */ });
}
