import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { errorMessage } from "../../shared/lib/errorMessage";
import { FOLDER_IMPORTS_CHANGED, SKIPPED_OUTCOMES, folderImportsClient, type FolderActivity, type FolderImports } from "./folderImportsApi";

type Call = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type Listen = (event: string, handler: () => void) => Promise<() => void>;

const defaultListen: Listen = (event, handler) => listen(event, handler);

/** The open profile's watched-folder imports for the Transactions page: the queue of exports
 * waiting for review, recent activity, and whether files were skipped since the page opened.
 * Asks the native side to look at the folder when the profile opens and whenever the window
 * comes back to the front (after sleep, say), and reads everything again when discovery reports a
 * change. Replies to an older read never overwrite a newer one. */
export function useFolderImports({
  active,
  call = invoke,
  listenTo = defaultListen,
}: {
  /** False until the profile's data has loaded (and while it is replaced). */
  active: boolean;
  call?: Call;
  listenTo?: Listen;
}) {
  const client = useMemo(() => folderImportsClient(call), [call]);
  const [data, setData] = useState<FolderImports | null>(null);
  const [activity, setActivity] = useState<FolderActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The newest activity entry already "seen" (kept in the profile, so files skipped while the app
  // was starting are news too): skips after it are announced until Folder activity is opened.
  const [seenThrough, setSeenThrough] = useState<number | null>(null);
  const sequence = useRef(0);

  /** Makes every read still in flight unable to publish (the profile went away). */
  const invalidate = useCallback(() => {
    sequence.current++;
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++sequence.current;
    try {
      const [next, entries] = await Promise.all([client.get(), client.activity()]);
      if (mine !== sequence.current) return;
      setData(next);
      setActivity(entries);
      setError(null);
      setSeenThrough((seen) => Math.max(seen ?? 0, next.seen_activity_id));
    } catch (e) {
      if (mine === sequence.current) setError(errorMessage(e));
    }
  }, [client]);

  useEffect(() => {
    if (!active) return;
    let closed = false;
    let unlisten: (() => void) | null = null;
    void refresh();
    // On opening (and unlocking, which remounts the page): look for exports saved while closed.
    client.scanNow().catch(() => undefined);
    listenTo(FOLDER_IMPORTS_CHANGED, () => void refresh())
      .then((stop) => {
        if (closed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    const onFocus = () => {
      client.scanNow().catch(() => undefined);
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      closed = true;
      invalidate();
      unlisten?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [active, client, refresh, listenTo, invalidate]);

  const skippedSinceSeen = seenThrough === null ? 0 : activity.filter((e) => e.id > seenThrough && SKIPPED_OUTCOMES.has(e.outcome)).length;

  return {
    data,
    activity,
    error,
    refresh,
    client,
    pendingCount: data?.pending.length ?? 0,
    /** Whether folder imports were ever set up here, so the Folder activity button is worth showing. */
    configured: !!data && (data.mappings.length > 0 || data.pending.length > 0 || data.folder !== null || activity.length > 0),
    skippedSinceSeen,
    /** Folder activity was opened: the skipped-file notice has been read, here and next time. */
    markActivitySeen: async () => {
      const through = activity.reduce((max, e) => Math.max(max, e.id), seenThrough ?? 0);
      setSeenThrough(through);
      await client.markSeen(through).catch(() => undefined);
    },
  };
}

export type FolderImportsState = ReturnType<typeof useFolderImports>;
