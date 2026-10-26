/** Reusable runtime predicates. Compile field entries once per schema, not per row. */
export type Check = (value: unknown) => boolean;
export const string: Check = (v) => typeof v === "string";
export const boolean: Check = (v) => typeof v === "boolean";
export const integer: Check = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export const id: Check = (v) => integer(v) && (v as number) > 0;
export const decimal: Check = (v) => typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v);
export const date: Check = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
};
export const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
export const array =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check);
export const object = (fields: Record<string, Check>): Check => {
  const entries = Object.entries(fields);
  return (v) =>
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    entries.every(
      ([key, check]) => Object.prototype.hasOwnProperty.call(v, key) && check((v as Record<string, unknown>)[key]),
    );
};
