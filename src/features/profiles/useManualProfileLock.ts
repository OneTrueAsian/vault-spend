import { useEffect, useRef, useState } from "react";

export async function captureManualLockGeneration(displayedId: string | undefined, generation: () => Promise<number>, activeProfileId: () => Promise<string | undefined>) {
  if (!displayedId) throw new Error("The active profile changed before it could be locked.");
  const captured = await generation();
  if (await activeProfileId() !== displayedId || await generation() !== captured) {
    throw new Error("The active profile changed before it could be locked.");
  }
  return captured;
}

export function useManualProfileLock({ generation, originGeneration = generation, lock, dirty, onError }: {
  generation: () => Promise<number>;
  originGeneration?: () => Promise<number>;
  lock: (generation: number) => Promise<unknown>;
  dirty: () => boolean;
  onError: (error: unknown) => void;
}) {
  const [pending, setPending] = useState<number | null>(null);
  const alive = useRef(true);
  const busy = useRef(false);
  const request = useRef(0);
  useEffect(() => {
    const requests = request;
    alive.current = true;
    return () => { alive.current = false; requests.current++; };
  }, []);
  async function perform(expected: number) {
    if (!alive.current || await generation() !== expected || !alive.current) return;
    await lock(expected); // Backend rechecks the generation atomically when closing the session.
  }
  async function start() {
    if (busy.current || pending !== null) return;
    busy.current = true;
    const current = ++request.current;
    try {
      const expected = await originGeneration();
      if (!alive.current || current !== request.current) return;
      if (dirty()) setPending(expected);
      else await perform(expected);
    } catch (error) { if (alive.current) onError(error); }
    finally { busy.current = false; }
  }
  function cancel() { request.current++; setPending(null); }
  async function confirm() {
    if (pending === null || busy.current) return;
    busy.current = true;
    const expected = pending;
    setPending(null);
    try { await perform(expected); }
    catch (error) { if (alive.current) onError(error); }
    finally { busy.current = false; }
  }
  return { needsConfirmation: pending !== null, start, cancel, confirm };
}
