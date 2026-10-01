import { useId, useState } from "react";
import { MenuSelect } from "../MenuSelect";
import type { AgeInput } from "./types";
import { parseAgeEntry, type AgeEntry } from "./setupDraft";

function initialEntry(value: AgeInput | null): AgeEntry {
  if (value?.kind === "band") return { kind: "band", min: String(value.min), max: value.max === null ? "" : String(value.max) };
  return { kind: "exact", age: value?.kind === "exact" ? String(value.age) : "" };
}

/** Age as either a whole number or a band ("25–34", "65 and over"); both are equally supported.
 * Edits stay in the field until they are valid; `onChange` only ever receives a valid age (or null
 * when the field is cleared), so a half-typed number is never saved. */
export function AgeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: AgeInput | null;
  onChange: (age: AgeInput | null) => void;
}) {
  const [entry, setEntry] = useState<AgeEntry>(() => initialEntry(value));
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function update(next: AgeEntry) {
    setEntry(next);
    const blank = next.kind === "exact" ? next.age.trim() === "" : next.min.trim() === "" && next.max.trim() === "";
    if (blank) {
      setError(null);
      onChange(null);
      return;
    }
    const parsed = parseAgeEntry(next);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onChange(parsed.ok);
  }

  function switchKind(kind: "exact" | "band") {
    if (kind === entry.kind) return;
    update(kind === "exact" ? { kind: "exact", age: "" } : { kind: "band", min: "", max: "" });
  }

  return (
    <fieldset className="cmp-age-field" data-cmp-age-field>
      <legend>{label}</legend>
      <div className="cmp-age-row">
        <MenuSelect
          ariaLabel={`${label}: how to enter it`}
          value={entry.kind}
          options={[
            { value: "exact", label: "Exact age" },
            { value: "band", label: "Age range" },
          ]}
          onChange={(v) => switchKind(v as "exact" | "band")}
        />
        {entry.kind === "exact" ? (
          <input
            type="text"
            inputMode="numeric"
            aria-label={`${label}: age`}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            value={entry.age}
            onChange={(e) => update({ kind: "exact", age: e.target.value })}
            className="cmp-age-input"
            data-cmp-age
          />
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              aria-label={`${label}: youngest age in the range`}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              value={entry.min}
              onChange={(e) => update({ kind: "band", min: e.target.value, max: entry.max })}
              className="cmp-age-input"
              data-cmp-age-min
            />
            <span aria-hidden="true">to</span>
            <input
              type="text"
              inputMode="numeric"
              aria-label={`${label}: oldest age in the range (leave empty for no upper limit)`}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              value={entry.max}
              placeholder="and over"
              onChange={(e) => update({ kind: "band", min: entry.min, max: e.target.value })}
              className="cmp-age-input"
              data-cmp-age-max
            />
          </>
        )}
      </div>
      {error && (
        <p id={errorId} className="cmp-field-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
