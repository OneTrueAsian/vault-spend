import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentGeneration, getProfileUiState, setProfileUiState } from "./profileUiState";

/** What a profile that has never chosen sees: Mobile, Password, Backup (ids from `settingsIndex.ts`). */
export const DEFAULT_QUICK_SETTINGS: readonly string[] = ["mobile-snapshots", "password-protection", "backups"];

const saveFailedMessage = "Couldn't save your Quick settings. Try again.";

/** Reads the saved list. Missing, unreadable or not a list of text gives the defaults; an empty list is a saved
 * choice and stays empty. Ids that no longer exist and repeats are dropped, order kept. */
export function parseQuickSettings(raw: string | null, isKnownId: (id: string) => boolean): string[] {
  let saved: unknown = null;
  if (raw !== null) {
    try {
      saved = JSON.parse(raw);
    } catch {
      saved = null;
    }
  }
  const list = Array.isArray(saved) && saved.every((id) => typeof id === "string") ? (saved as string[]) : DEFAULT_QUICK_SETTINGS;
  return list.filter((id, i) => isKnownId(id) && list.indexOf(id) === i);
}

export const serializeQuickSettings = (ids: readonly string[]): string => JSON.stringify(ids);

/** The open profile's Quick settings list. `ids` is null until it has loaded. A write that fails puts the list back
 * as it was and sets `error`. App remounts when the profile changes, so a list never carries over between profiles. */
export function useQuickSettings(isKnownId: (id: string) => boolean) {
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string[] | null>(null);
  const known = useRef(isKnownId);
  known.current = isKnownId;

  useEffect(() => {
    let alive = true;
    getProfileUiState("quick_settings")
      .then((raw) => parseQuickSettings(raw, known.current))
      .catch(() => parseQuickSettings(null, known.current))
      .then((list) => {
        if (!alive) return;
        current.current = list;
        setIds(list);
      });
    return () => {
      alive = false;
    };
  }, []);

  const write = useCallback(async (next: string[]) => {
    const before = current.current;
    current.current = next;
    setIds(next);
    setError(null);
    try {
      const generation = await getCurrentGeneration();
      await setProfileUiState("quick_settings", serializeQuickSettings(next), generation);
    } catch {
      current.current = before;
      setIds(before);
      setError(saveFailedMessage);
    }
  }, []);

  const add = useCallback((id: string) => {
    const list = current.current;
    if (list && !list.includes(id)) void write([...list, id]);
  }, [write]);
  const remove = useCallback((id: string) => {
    const list = current.current;
    if (list && list.includes(id)) void write(list.filter((x) => x !== id));
  }, [write]);
  const has = useCallback((id: string) => (ids ?? []).includes(id), [ids]);

  return { ids, has, add, remove, error };
}
