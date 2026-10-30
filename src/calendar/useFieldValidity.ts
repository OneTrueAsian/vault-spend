import { useCallback, useState } from "react";

/** For a custom Save that several date or month fields must all allow. Each field reports through
 * `track("its name")` (its `onValidityChange`); `valid` is false while any of them holds text that is not
 * a usable value. A field that goes away reports itself valid again, so nothing is left blocked. */
export function useFieldValidity() {
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(() => new Set());
  const track = useCallback(
    (name: string) => (valid: boolean) =>
      setInvalid((previous) => {
        if (previous.has(name) === !valid) return previous;
        const next = new Set(previous);
        if (valid) next.delete(name);
        else next.add(name);
        return next;
      }),
    [],
  );
  return { valid: invalid.size === 0, track };
}
