import type { LucideIcon } from "lucide-react";
import { NOUN_ICONS, type NounIconId } from "./nounIcons";
import { FLAT_ICONS, type FlatIconId } from "./flatIcons";

/** One resolved icon choice, shared by accountIcons.tsx/categoryIcons.tsx/
 * bucketIcons.tsx's lookup tables, which each map a domain concept (account
 * type, category name, bucket) to one of these:
 * - `image` — a bundled Noun Project glyph (`nounIcons.ts`), monochrome by
 *   license, forced to solid black/white via `.icon-img`.
 * - `image-color` — a bundled full-color icon (`flatIcons.ts`), rendered
 *   with its original colors intact via `.icon-img-color`.
 * - `lucide` — a vector icon that recolors itself via `currentColor`. */
export type IconEntry =
  | { kind: "image"; src: string }
  | { kind: "image-color"; src: string }
  | { kind: "lucide"; Icon: LucideIcon };

/** Shorthand for `{ kind: "image", src: NOUN_ICONS[id].src }` — every
 * monochrome image `IconEntry` in this app's lookup tables ultimately
 * points at a `NOUN_ICONS` id, never a raw import, so there's exactly one
 * place (`nounIcons.ts`) that touches `assets/icons/*.png` directly. */
export function nounIconEntry(id: NounIconId): IconEntry {
  return { kind: "image", src: NOUN_ICONS[id].src };
}

/** Same shorthand, for the full-color set — see `flatIcons.ts`. */
export function flatIconEntry(id: FlatIconId): IconEntry {
  return { kind: "image-color", src: FLAT_ICONS[id].src };
}

/** Renders whichever kind of `IconEntry` it's given — sizing is left to the
 * caller's CSS (`className`). A Lucide icon recolors via `currentColor` on
 * its own; a monochrome bundled image gets `icon-img` (dark-mode invert,
 * see App.css); a full-color bundled image gets `icon-img-color` instead —
 * no filter, so its own colors show through. */
export function IconEntryGlyph({ entry, className }: { entry: IconEntry; className?: string }) {
  if (entry.kind === "image") {
    return <img src={entry.src} alt="" className={className ? `${className} icon-img` : "icon-img"} aria-hidden="true" />;
  }
  if (entry.kind === "image-color") {
    return (
      <img src={entry.src} alt="" className={className ? `${className} icon-img-color` : "icon-img-color"} aria-hidden="true" />
    );
  }
  const Icon = entry.Icon;
  return <Icon className={className} aria-hidden="true" />;
}

/** Shared swatch-row icon picker — one button per option, rendered via
 * whatever `renderIcon` the caller supplies (each domain's `*_ICON_OPTIONS`
 * needs a different component — `AccountTypeIcon`/`CategoryIcon`/
 * `BucketIcon` — to preview a swatch, so this stays generic over the key
 * type rather than hardcoding one of them). `value: null` means "no
 * explicit choice," same convention every icon picker in this app uses.
 *
 * `size="lg"` renders larger swatches (see `.icon-picker-swatch-lg` in
 * App.css) — the default "sm" size is legible for simple flat-color
 * glyphs (a house, a car, a gift box), but the profile-avatar set's
 * detailed illustrated faces need more pixels to actually tell apart, so
 * `profileIcons.tsx`'s picker opts into "lg". */
export function IconPicker<K extends string>({
  options,
  value,
  onChange,
  renderIcon,
  size = "sm",
}: {
  options: { key: K }[];
  value: K | null;
  onChange: (key: K) => void;
  renderIcon: (key: K) => React.ReactNode;
  size?: "sm" | "lg";
}) {
  return (
    <div className={size === "lg" ? "icon-picker icon-picker-lg" : "icon-picker"} role="group" aria-label="Icon">
      {options.map((opt) => {
        const swatchClass = ["icon-picker-swatch", size === "lg" && "icon-picker-swatch-lg", value === opt.key && "icon-picker-swatch-active"]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            type="button"
            key={opt.key}
            className={swatchClass}
            title={opt.key}
            aria-label={`Use the ${opt.key} icon`}
            onClick={() => onChange(opt.key)}
          >
            {renderIcon(opt.key)}
          </button>
        );
      })}
    </div>
  );
}
