# Ask the Vault test support

These modules are consumed by tests, not the application:

| Module | Responsibility |
|---|---|
| retirementNativeFixtures.ts | Fictional profile seeds, expected native retirement replies, and a reference model |
| spendingScenarioFixtures.ts | Fictional spending inputs and calculated screen examples |
| retirementScenarioParity.testdata.ts | Existing full-output parity digests; do not regenerate them to hide discrepancies |
| retirementPerformanceProtocol.ts | Validation of supplied performance evidence; its colocated tests use synthetic evidence and do not run benchmarks |

The separate `../askVaultM6/` directory contains frozen scoring inputs. Do not move these helpers into that directory or modify its freeze inventory as routine cleanup. Retirement corpus/contract examples remain with their responsibility under `../../askVault/retirement/`; version 16 records the owner-authorized path changes and preserves earlier freeze records and fixture values.

For runtime ownership and reading routes, see [Ask the Vault](../../askVault/README.md).
