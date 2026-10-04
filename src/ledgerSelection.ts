/** Select all on the Transactions tab: every matching row, at most `SELECT_ALL_CAP` transactions
 * at a time so a bulk change stays quick. Once a change has been applied (the selection cleared),
 * the next press picks the next batch: rows from earlier batches are left out, whether or not the
 * change made them stop matching the filter. A batch unticked without a change is not "done". */

export const SELECT_ALL_CAP = 250;

/** The current batch, and every transaction an earlier, applied batch already covered. */
export type SelectAllBatch = { ids: Set<number>; done: Set<number> };

export type SelectAllResult = {
  selected: Set<number>;
  batch: SelectAllBatch;
  /** Transactions matching the filter, in all. */
  matching: number;
  /** Matching transactions in neither this batch nor an earlier one. */
  remainingAfter: number;
};

/** The next Select all. `rows` are the ledger's matching rows in order, each the ids it stands
 * for (a merged transfer row is two transactions, never split across batches). */
export function selectAllNext(
  rows: number[][],
  selected: Set<number>,
  batch: SelectAllBatch | null,
  cap = SELECT_ALL_CAP,
): SelectAllResult {
  const done = new Set(batch?.done ?? []);
  // The last batch counts as done once a change cleared it: none of it is still selected.
  if (batch && batch.ids.size > 0 && ![...batch.ids].some((id) => selected.has(id))) {
    for (const id of batch.ids) done.add(id);
  }
  const picked = new Set<number>();
  let matching = 0;
  let remainingAfter = 0;
  let full = false;
  for (const ids of rows) {
    matching += ids.length;
    if (ids.every((id) => done.has(id))) continue;
    if (!full && picked.size + ids.length <= cap) {
      for (const id of ids) picked.add(id);
    } else {
      full = true;
      remainingAfter += ids.filter((id) => !done.has(id)).length;
    }
  }
  return { selected: new Set(picked), batch: { ids: picked, done }, matching, remainingAfter };
}

/** Whether exactly the current batch is selected (the header checkbox shows ticked). */
export function isBatchSelected(batch: SelectAllBatch | null, selected: Set<number>): boolean {
  return !!batch && batch.ids.size > 0 && batch.ids.size === selected.size && [...batch.ids].every((id) => selected.has(id));
}

/** Unticking the header checkbox: the batch is dropped without counting as done. */
export function unselectBatch(batch: SelectAllBatch): SelectAllBatch {
  return { ids: new Set(), done: batch.done };
}

/** Whether `adding` more transactions still fit under the cap. */
export function canSelectMore(selected: Set<number>, adding: number, cap = SELECT_ALL_CAP): boolean {
  return selected.size + adding <= cap;
}

/** The note shown when Select all stopped at the cap; `null` when every matching row is selected. */
export function selectAllNote(result: SelectAllResult): string | null {
  if (result.remainingAfter === 0) return null;
  const next = Math.min(SELECT_ALL_CAP, result.remainingAfter);
  return (
    `Selected ${result.selected.size.toLocaleString("en-US")} of the ${result.matching.toLocaleString("en-US")} matching transactions. ` +
    `A change can apply to at most ${SELECT_ALL_CAP} at a time: apply your change, then press Select all again for the next ${next.toLocaleString("en-US")}.`
  );
}
