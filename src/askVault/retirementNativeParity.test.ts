import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { retirementNativeFixtures } from "./retirementNativeFixtures";

it("N3: the kept Rust parity seeds and hand expectations remain byte-for-value identical to all 43 frozen TS fixtures", () => {
  const raw = JSON.parse(readFileSync("core/src/store/tests/ask_vault_retirement_fixtures.json", "utf8"));
  expect(raw).toHaveLength(43); expect(raw).toEqual(retirementNativeFixtures());
});
