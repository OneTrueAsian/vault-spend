/** Independent browser ingress boundary. No desktop imports, IPC, DB or network calls. */
import contract from "../core/src/mobile_snapshot_v1.schema.json";
import type { MobileSnapshotV1 } from "./mobileSnapshotTypes";
export type { MobileSnapshotV1 } from "./mobileSnapshotTypes";
export const MAX_MOBILE_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export class MobileSnapshotVersionError extends Error {
  constructor(){super("This snapshot needs a newer viewer. Reopen the current desktop viewer address. Your saved copy was kept.");}
}

interface Rule {
  $ref?: string; anyOf?: Rule[]; type?: string; const?: unknown; enum?: unknown[];
  properties?: Record<string, Rule>; required?: string[]; items?: Rule;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; format?: string;
}
const defs: Record<string, Rule> = contract.$defs;
function reject(path: string): never { throw new Error(`Invalid mobile snapshot at ${path}`); }
function validDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) > 0 &&
    !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
}
function validFormat(v: string, format: string): boolean {
  switch (format) {
    case "date": return validDate(v);
    case "month": return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && Number(v.slice(0, 4)) > 0;
    case "utc-timestamp": return /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/.test(v) && validDate(v.slice(0, 10));
    case "opaque-id": return /^[A-Za-z0-9_-]+$/.test(v);
    case "exact-decimal": return /^-?(0|[1-9]\d{0,14})(\.\d{1,12})?$/.test(v);
    case "sequence": return /^(0|[1-9]\d{0,19})$/.test(v) && BigInt(v) <= 18446744073709551615n;
    default: throw new Error(`Unknown contract format: ${format}`);
  }
}
function validate(value: unknown, rule: Rule, path: string): void {
  if (rule.$ref) return validate(value, defs[rule.$ref.split("/").pop()!], path);
  if (rule.anyOf) {
    for (const option of rule.anyOf) { try { validate(value, option, path); return; } catch { /* try next arm */ } }
    reject(path);
  }
  if ("const" in rule && value !== rule.const) reject(path);
  if (rule.enum && !rule.enum.includes(value)) reject(path);
  switch (rule.type) {
    case "null": if (value !== null) reject(path); break;
    case "string": {
      if (typeof value !== "string") reject(path);
      const length = [...value].length;
      if (length < (rule.minLength ?? 0) || length > (rule.maxLength ?? Infinity) || (rule.format && !validFormat(value, rule.format))) reject(path);
      break;
    }
    case "integer": if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (rule.minimum ?? 0) || value > (rule.maximum ?? Infinity)) reject(path); break;
    case "boolean": if (typeof value !== "boolean") reject(path); break;
    case "array": if (!Array.isArray(value)) reject(path); else value.forEach((v, i) => validate(v, rule.items!, `${path}[${i}]`)); break;
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) reject(path);
      const object = value as Record<string, unknown>;
      for (const key of rule.required!) if (!Object.prototype.hasOwnProperty.call(object, key)) reject(`${path}.${key}`);
      for (const [key, v] of Object.entries(object)) {
        if (!Object.prototype.hasOwnProperty.call(rule.properties!, key)) reject(path);
        validate(v, rule.properties![key], `${path}.${key}`);
      }
      break;
    }
    default: throw new Error("Unsupported contract rule");
  }
}
function unique(ids: string[], path: string): void { if (new Set(ids).size !== ids.length) reject(path); }
function invariant(v: MobileSnapshotV1): void {
  if (v.history.actualThrough !== v.asOfDate) reject("history.actualThrough");
  for (const [name, section] of Object.entries(v.sections)) {
    if ((section.state === "available") !== (section.reason === null)) reject(`sections.${name}`);
  }
  unique(v.accounts.map(a => a.id), "accounts"); unique(v.members.map(m => m.id), "members");
  unique(v.budgets.map(b => b.month), "budgets"); unique(v.history.months.map(m => m.month), "history.months");
  const accountIds = new Set(v.accounts.map(a => a.id));
  const memberIds = new Set(v.members.map(m => m.id));
  for (const a of v.accounts) if (a.memberId !== null && !memberIds.has(a.memberId)) reject("accounts.memberId");
  for (const item of [...v.calculators.accumulation, ...v.calculators.debts, ...v.investments.accounts]) {
    if (!accountIds.has(item.accountId)) reject("accountId");
  }
  for (const c of [v.investments.coverage, ...v.investments.accounts.map(a => a.coverage)]) {
    if (c.valuedPositions > c.totalPositions || (c.state === "complete" && c.valuedPositions !== c.totalPositions)) reject("investments.coverage");
  }
  for (const item of [v.investments, ...v.investments.accounts]) {
    if (item.dayChange !== null && (item.coverage.state !== "complete" || item.coverage.previousCloseDate !== v.asOfDate || item.coverage.totalPositions === 0)) reject("investments.dayChange");
  }
  unique(v.investments.accounts.map(a => a.accountId), "investments.accounts");
  unique(v.calculators.accumulation.map(a => a.accountId), "calculators.accumulation");
  unique(v.calculators.debts.map(a => a.accountId), "calculators.debts");
  for (const a of v.calculators.accumulation) {
    unique(a.months.map(m => m.month), "calculators.accumulation.months");
    if (a.months.some(m => m.month > v.asOfDate.slice(0, 7)) || a.valueHistory.some(h => h.date > v.asOfDate)) reject("calculators.accumulation.history");
  }
  const months = v.history.months.map(m => m.month);
  if (months.length === 0) { if (v.history.fromMonth !== null || v.history.throughMonth !== null) reject("history.bounds"); }
  else {
    if (v.history.fromMonth !== months[0] || v.history.throughMonth !== months[months.length - 1]) reject("history.bounds");
    for (let i = 0; i < months.length; i++) {
      if (months[i] > v.asOfDate.slice(0, 7)) reject("history.months");
      if (i > 0) {
        const index = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5));
        if (index(months[i]) !== index(months[i - 1]) + 1) reject("history.months");
      }
    }
  }
  for (const rows of [v.history.categories, v.history.budgetCategoryNet, v.history.accounts, v.history.members, v.history.tags, v.history.merchants]) {
    for (const row of rows) if (!months.includes(row.month)) reject("history.month");
  }
  for (const rows of [v.history.daily, v.history.netWorth, v.history.portfolio]) {
    for (const row of rows) if (row.date > v.asOfDate) reject("history.date");
  }
  for (const b of v.budgets) {
    unique(b.lines.map(l => l.category), "budgets.lines");
    if (b.actualThrough !== null && (b.actualThrough > v.asOfDate || b.actualThrough.slice(0, 7) !== b.month)) reject("budgets.actualThrough");
    if (b.month > v.asOfDate.slice(0, 7) && (b.actualThrough !== null || [...b.lines.map(l => l.actual), b.actualIncome, b.actualSpending, b.unbudgetedSpending].some(a => BigInt(a.replace(".", "")) !== 0n))) reject("budgets.futureActual");
  }
  if (v.calculators.forecast.throughDate < v.asOfDate) reject("calculators.forecast.throughDate");
  for (const s of v.calculators.forecast.schedule) if (s.date < v.asOfDate || s.date > v.calculators.forecast.throughDate) reject("calculators.forecast.schedule");
}
/** The caller supplies identity from pairing, never from the untrusted response itself. */
export function parseMobileSnapshot(json: string, expected?: { installationId: string; profileId: string }): MobileSnapshotV1 {
  if (json.length > MAX_MOBILE_SNAPSHOT_BYTES || new TextEncoder().encode(json).length > MAX_MOBILE_SNAPSHOT_BYTES) reject("size");
  let value: unknown;
  try { value = JSON.parse(json); } catch { reject("json"); }
  if(value&&typeof value==="object"){
    const version=value as {schemaVersion?:unknown;minimumViewerVersion?:unknown};
    if([version.schemaVersion,version.minimumViewerVersion].some(v=>typeof v==="number"&&Number.isInteger(v)&&v>1))throw new MobileSnapshotVersionError();
  }
  validate(value, { $ref: "#/$defs/MobileSnapshotV1" }, "snapshot");
  const snapshot = value as MobileSnapshotV1;
  if (expected && (snapshot.installationId !== expected.installationId || snapshot.profile.id !== expected.profileId)) reject("identity");
  invariant(snapshot);
  return snapshot;
}
