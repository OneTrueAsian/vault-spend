import { readFileSync } from "node:fs";
import type { CorpusCase } from "./manifest";
import { m5StopCases } from "./scenarioPreparation";

/** Frozen preparation inventory, not a claim that combined M6 acceptance has run.
 * Context IDs remain namespaced by package; their individual proof manifests must be validated before merging observations.
 * Original ordinary data and scenario v1 data are preserved. Routing obligations are nonfinancial and outside either numeric floor. */
const read = <T,>(name: string): T => JSON.parse(readFileSync(`${__dirname}/${name}`, "utf8"));
export function preparedCaseGroups(): Record<string, CorpusCase[]> {
  return { ordinary: read("cases.json"), m3: read("scenarioM3Cases.json"), m4: read("scenarioM4Cases.json"),
    m5: [...read<CorpusCase[]>("scenarioM5Cases.json"), ...m5StopCases()], history: read("historyCases.json") };
}
export const preparedRoutingCases = () => read<{ id: string; family: string; text: string; expectedRoute: string }[]>("routingCases.json");
