import type { StatusKind } from "../shared/native/appTypes";

/** How long the shared status line stays, in milliseconds. An error stays until the person dismisses it or a newer message
 * replaces it, so it is never missed by someone who looked away (VS-53); confirmations and in-progress notes fade. */
export function statusLifetimeMs(kind: StatusKind): number | null {
  return kind === "error" ? null : 10000;
}
