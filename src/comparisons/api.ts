import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { getCurrentGeneration } from "../profileUiState";
import type { ComparisonSetup, ComparisonsResponse, SaveResponse, SetupResponse } from "./types";

// Every call carries the generation its component captured when it mounted. The backend refuses a
// call whose generation is no longer the active profile's, so a late reply or save can never reach
// another profile after a lock, switch or restore (the app remounts with a new key when the profile
// changes, so a captured value cannot outlive the profile it was read for). Callers decide how to show
// the refusal; none of these swallow it.

/** The backend's generation, read once when the component mounts. `null` until it arrives. */
export function useGeneration(): number | null {
  const [generation, setGeneration] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    getCurrentGeneration()
      .then((g) => {
        if (!cancelled) setGeneration(g);
      })
      .catch(() => {
        // No profile open (locked or starting up): there is nothing to compare, and the page unmounts.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return generation;
}

export const getComparisons = (expectedGeneration: number) =>
  invoke<ComparisonsResponse>("get_financial_comparisons", { expectedGeneration });

export const getComparisonSetup = (expectedGeneration: number) =>
  invoke<SetupResponse>("get_comparison_setup", { expectedGeneration });

export const saveComparisonSetup = (expectedGeneration: number, expectedRevision: number, setup: ComparisonSetup) =>
  invoke<SaveResponse>("save_comparison_setup", { expectedGeneration, expectedRevision, setup });
