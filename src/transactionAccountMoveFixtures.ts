import type { MovePreviewResponse, MoveResult } from "./transactionAccountMove";

/** Plain-data stand-ins for what the native move commands return, for tests of the move review. */
export function previewFixture(over: Partial<MovePreviewResponse["preview"]> = {}): MovePreviewResponse {
  return {
    contractVersion: 2,
    revision: { local: 3, external: 1 },
    preview: {
      destinationAccountId: 2, destinationName: "Savings", asOf: "2026-10-29", selectedCount: 2, effectiveCount: 2, alreadyThereCount: 0, normalizedIds: [1, 2],
      sources: [{ accountId: 1, accountName: "Checking", count: 2 }], firstDate: "2026-10-05", lastDate: "2026-10-06", total: "-9.00",
      rows: [
        { id: 1, date: "2026-10-05", description: "Cafe", amount: "-4.00", accountId: 1, accountName: "Checking", status: "move" },
        { id: 2, date: "2026-10-06", description: "Bus", amount: "-5.00", accountId: 1, accountName: "Checking", status: "move" },
      ],
      effects: [
        { accountId: 1, accountName: "Checking", accountType: "checking", role: "source", movedCount: 2, label: "Balance", current: "991.00", projected: "1000.00", availableCurrent: null, availableProjected: null, transactionChange: "9.00", holdingsOverride: false, projectedIsFinal: true },
        { accountId: 2, accountName: "Savings", accountType: "savings", role: "destination", movedCount: 2, label: "Balance", current: "500.00", projected: "491.00", availableCurrent: null, availableProjected: null, transactionChange: "-9.00", holdingsOverride: false, projectedIsFinal: true },
      ],
      warnings: [], blockers: [], canCommit: true, token: "abc123",
      status: "ready", mode: "automatic", confirmations: [], checkpointEffects: { correctedCount: 0, firstDate: null, lastDate: null, notes: [] }, netBefore: "1491.00", netAfter: "1491.00",
      ...over,
    },
  };
}

export function resultFixture(over: Partial<MoveResult> = {}): MoveResult {
  return {
    contractVersion: 2, status: "moved", movedIds: [1, 2], movedCount: 2, alreadyThereIds: [], alreadyThereCount: 0, affectedAccountIds: [1, 2], blockers: [],
    mode: "automatic", operationId: "op-1", replayed: false, correctedCheckpoints: 0, confirmedAccountIds: [], revision: { local: 4, external: 1 }, ...over,
  };
}
