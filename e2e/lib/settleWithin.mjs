// Wait for a promise, but never longer than `ms`, and never leave the timeout running. Resolves to the promise's value, or to undefined once
// the limit passes; a rejection is passed on. The timer is always cleared: an uncleared one keeps the Node process alive until it fires.
export async function settleWithin(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(resolve, ms); })]);
  } finally {
    clearTimeout(timer);
  }
}
