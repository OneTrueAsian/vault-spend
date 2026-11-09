/** Observes a background read without allowing an unhandled rejection.
 * Kept separate so the App's actual failure-reporting orchestration is testable. */
export async function observeRead(read: () => Promise<unknown>, report: (error: unknown) => void): Promise<void> {
  try {
    await read();
  } catch (error) {
    // These replies belong to a replaced read/profile, not a failed current action.
    if (error && typeof error === "object" && "code" in error &&
      (error.code === "superseded" || error.code === "stale_profile")) return;
    report(error);
  }
}

/** Read and publish one refresh. Write failures remain the caller's responsibility. */
export async function publishRead<T>(read: () => Promise<T>, publish: (value: T) => void): Promise<void> {
  let value: T;
  try {
    value = await read();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error &&
      (error.code === "superseded" || error.code === "stale_profile")) return;
    throw error;
  }
  publish(value);
}
