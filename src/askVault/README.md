# Ask the Vault

Ask the Vault parses questions locally, reads approved financial data through the native client, and presents answers or confirmed scenario illustrations. Start with the card and follow the relevant route below.

## Folder ownership

| Folder | Responsibility |
|---|---|
| `ordinary/` | Ordinary query parsing, reply contracts, controller, answer rendering and hook, with their tests |
| `spending/` | Spending-scenario parsing, preparation, arithmetic, view model, hook and related tests |
| `cutPreview/` | Spending-cut parsing, batch/baseline preparation, arithmetic, contract, hook and related tests |
| `retirement/` | Retirement parsing, native context, calculations, screen contracts, hook and corpus/parity tests |
| `common/` | Types and helpers shared by these routes: dates, money, vendor matching and result invalidation |
| `acceptance/` | Cross-route acceptance, grading integrity, source evidence and scoring-freeze tests |

Keep feature tests beside their owner. Cross-route acceptance tests belong in `acceptance/`. No barrel or compatibility wrappers conceal the actual module owner.

## Reading routes

| Responsibility | Start here | Follow through |
|---|---|---|
| Card and route selection | [AskVaultCard](../AskVaultCard.tsx) | Ordinary answers, legacy matching, or one of the scenario hooks below |
| Ordinary spending questions | [useAskVault](ordinary/useAskVault.ts) | [controller](ordinary/controller.ts) → [parser](ordinary/parser.ts) → [financial client](../shared/native/financialReads.ts) → [answer](ordinary/answer.ts) |
| Legacy question matching | [transactionQa](../transactionQa.ts) | Card handoff and the existing compatibility tests |
| Spending scenarios | [useSpendingScenario](spending/useSpendingScenario.ts) | spendingScenarioParser → spendingScenarioBaseline → spendingScenarioMath → spendingScenarioView → [dialog](../SpendingScenarioDialog.tsx) |
| Spending-cut previews | [useCutPreview](cutPreview/useCutPreview.ts) | cutPreviewParser, cutPreviewBaseline, cutPreviewBatch, cutPreviewMath → [dialog](../CutPreviewDialog.tsx) |
| Retirement illustrations | [useRetirementScenario](retirement/useRetirementScenario.ts) | retirementParser, retirementContextReader, retirementScenarioMath, retirementScreenContract → [dialog](../RetirementScenarioDialog.tsx) |

These are reading routes, not a promise of a strictly linear call sequence. Scenario hooks coordinate preparation, clarification, explicit confirmation, calculation, and invalidation; inspect the hook for the actual ordering.

## Module responsibilities

- `common/types.ts`, `ordinary/contract.ts`, and `ordinary/contractV2.ts` define ordinary query shapes and validate replies. The scenario and retirement-native contracts define separate boundaries; version numbers are not interchangeable.
- `common/vendor.ts`, `distance.ts`, `dates.ts`, `calendar.ts`, and `savingLead.ts` support parsing and interpretation. `common/money.ts` supports exact scenario arithmetic; shared financial domain rules still belong to their existing owners.
- `common/changedState.ts`, `dataWriteEvents.ts`, and `ledgerSignature.ts` support result retirement. Profile/session changes, financial writes, changed inputs, and new dates must retain their existing invalidation behavior.
- `retirement/retirementCorpus.ts`, `retirementCompiledCorpus.ts`, and `retirementScenarioContractExamples.ts` serve corpus/acceptance consumers. Their responsibility remains with retirement; non-test filenames do not imply application imports.
- The desktop boundaries live in [Ask commands](../../src-tauri/src/commands/ask_vault.rs), [retirement commands](../../src-tauri/src/commands/ask_vault_retirement.rs), [Ask storage](../../core/src/store/ask_vault.rs), and [retirement storage](../../core/src/store/ask_vault_retirement.rs).

## Test support and frozen paths

[testSupport/askVault](../testSupport/askVault/README.md) holds movable test-only fixtures and the performance-evidence validator. Its data is not part of the application's runtime graph. Keep test support out of runtime imports.

`src/testSupport/askVaultM6/` is a different owner: the scored corpus, references, native proof inputs, grading adapters, and immutable freeze history. Its inventory is part of the live freeze; adding a TypeScript or JSON file there changes that inventory.

The live `scoringFreeze.json` is the source of truth for directly hashed paths. Version 16 records this owner-authorized reorganization: the previous 94 inputs at their current locations plus `sourcePaths.ts`. Version 15 and all earlier signature records remain byte-identical. The new frozen relocation map lets source readers follow historical paths while preserving all corpus, reference, proof and typo-rule JSON bytes and source-line anchors.

Consequently:

- Preserve frozen input bytes and historical freeze records. Never refresh digests to conceal a failed check.
- Inspect frozen consumers and source-reading tests before moving a module or changing import lines. Passing type checks alone does not establish those contracts.
- Keep historical JSON source citations unchanged; resolve their current locations through `testSupport/askVaultM6/sourcePaths.ts` when reading source.
- Root-level card, Help, legacy matcher and scenario dialogs remain integration components. Their fixed-path tests and the concurrent shell refactor are separate from this module reorganization.
- Run `acceptance/scoringFreeze.test.ts` alongside affected behavior tests after organizational changes. A freeze check establishes input identity, not a passing acceptance score.

See [architecture and invariants](../../docs/ARCHITECTURE.md) and [repository validation guidance](../../AGENTS.md) for wider ownership and validation requirements.
