import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentGeneration, getProfileUiState, setProfileUiState } from "../../shared/lib/profileUiState";

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

/** The open profile's Quick settings list. `ids` is null until it has loaded. Saves run one after another, in the
 * order made. A save that fails puts the list back to what was last saved and sets `error`, unless a newer change has
 * been made since (that change saves the whole list again). App remounts when the profile changes, so a list never carries over between profiles.
 * Every save uses the profile generation read when the list loaded, and a save still queued after unmount is dropped, so it can never land in another profile. */
export function useQuickSettings(isKnownId: (id: string) => boolean) {
  const [ids, setIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<string[] | null>(null);
  const saved = useRef<string[] | null>(null);
  const latest = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const owner = useRef<Promise<number> | null>(null);
  const alive = useRef(true);
  const known = useRef(isKnownId);
  known.current = isKnownId;

  useEffect(() => {
    alive.current = true;
    const generation = getCurrentGeneration();
    owner.current = generation;
    generation
      .then(() => undefined, () => undefined)
      .then(() => getProfileUiState("quick_settings"))
      .then((raw) => parseQuickSettings(raw, known.current))
      .catch(() => parseQuickSettings(null, known.current))
      .then((list) => {
        if (!alive.current) return;
        current.current = list;
        saved.current = list;
        setIds(list);
      });
    return () => {
      alive.current = false;
    };
  }, []);

  const write = useCallback((next: string[]) => {
    const mine = ++latest.current;
    current.current = next;
    setIds(next);
    setError(null);
    queue.current = queue.current.then(async () => {
      if (!alive.current) return;
      try {
        // Only the generation read at load is ever used. If that read failed, every save here fails.
        await setProfileUiState("quick_settings", serializeQuickSettings(next), await owner.current!);
        saved.current = next;
      } catch {
        if (mine !== latest.current) return;
        current.current = saved.current;
        setIds(saved.current);
        setError(saveFailedMessage);
      }
    });
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
