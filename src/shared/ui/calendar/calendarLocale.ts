/** Regional conventions for the date and month pickers: which locale is in use, how a date is written and
 * read while it is being edited, how it reads when the field is closed, the week's first day, text
 * direction, and the month and weekday names. Everything is Gregorian (the stored dates always are) and
 * built on Intl; the app's own action labels stay in English. */
import { daysInMonth, type DateRecord, type MonthRecord } from "./calendarDate";

export type FieldKind = "date" | "month";
type Field = "day" | "month" | "year";
type Piece = { kind: "field"; field: Field } | { kind: "literal"; text: string };

export type EntryFormat<K extends FieldKind = FieldKind> = {
  kind: K;
  locale: string;
  /** What the editing text must look like, in the region's own order ("mm/dd/yyyy"). */
  hint: string;
  pieces: Piece[];
  digits: string[];
};

const BIDI_MARKS = /[‎‏؜‪-‮⁦-⁩]/g;
const stripMarks = (text: string) => text.replace(BIDI_MARKS, "");
const GREGORIAN = { calendar: "gregory", timeZone: "UTC" } as const;

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/** A valid requested locale, else the first usable browser language, else en-US. */
export function resolveLocale(requested?: string, languages: readonly string[] = browserLanguages()): string {
  for (const candidate of [requested, ...languages]) {
    if (!candidate) continue;
    try {
      const [supported] = Intl.DateTimeFormat.supportedLocalesOf(candidate);
      if (supported) return candidate;
    } catch {
      // not a language tag: try the next one
    }
  }
  return "en-US";
}

function utcDate(year: number, month: number, day: number): Date {
  const d = new Date(Date.UTC(2000, month - 1, day, 12));
  d.setUTCFullYear(year);
  return d;
}

const formats = new Map<string, EntryFormat>();

/** The region's numeric entry format for a date (day, month, year) or a month (month, year). */
export function getEntryFormat<K extends FieldKind>(locale: string, kind: K): EntryFormat<K> {
  const key = `${locale}|${kind}`;
  const cached = formats.get(key);
  if (cached) return cached as EntryFormat<K>;
  const options: Intl.DateTimeFormatOptions = { ...GREGORIAN, year: "numeric", month: "2-digit", ...(kind === "date" ? { day: "2-digit" } : {}) };
  const parts = new Intl.DateTimeFormat(locale, options).formatToParts(utcDate(2026, 10, 4));
  const pieces: Piece[] = [];
  for (const part of parts) {
    if (part.type === "day" || part.type === "month" || part.type === "year") pieces.push({ kind: "field", field: part.type });
    else if (part.type === "literal") pieces.push({ kind: "literal", text: stripMarks(part.value).replace(/\s+/g, " ") });
  }
  const numbers = new Intl.NumberFormat(locale, { useGrouping: false });
  const digits = Array.from({ length: 10 }, (_, n) => numbers.format(n));
  const hint = pieces.map((p) => (p.kind === "literal" ? p.text : p.field === "year" ? "yyyy" : p.field === "month" ? "mm" : "dd")).join("").trim();
  const format = { kind, locale, hint, pieces, digits } as EntryFormat<K>;
  formats.set(key, format as EntryFormat);
  return format;
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

function localDigits(format: EntryFormat, text: string): string {
  return text.replace(/[0-9]/g, (digit) => format.digits[Number(digit)]);
}

/** The editing text for a value: two-digit day and month, four-digit year, the region's separators. */
export function formatEntry(format: EntryFormat<"date">, value: DateRecord): string;
export function formatEntry(format: EntryFormat<"month">, value: MonthRecord): string;
export function formatEntry(format: EntryFormat, value: DateRecord | MonthRecord): string {
  const text = format.pieces
    .map((p) => {
      if (p.kind === "literal") return p.text;
      if (p.field === "year") return pad(value.year, 4);
      if (p.field === "month") return pad(value.month, 2);
      return pad((value as DateRecord).day, 2);
    })
    .join("")
    .trim();
  return localDigits(format, text);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const grammars = new Map<EntryFormat, RegExp>();

function grammarFor(format: EntryFormat): RegExp {
  const cached = grammars.get(format);
  if (cached) return cached;
  const first = format.pieces.findIndex((p) => p.kind === "field");
  let last = format.pieces.length - 1;
  while (last >= 0 && format.pieces[last].kind !== "field") last--;
  let source = "^";
  format.pieces.forEach((p, i) => {
    if (p.kind === "field") source += p.field === "year" ? "(\\d{4})" : "(\\d{1,2})";
    else if (i < first || i > last) source += p.text.trim() === "" ? "" : "(?:" + escapeRegExp(p.text.trim()) + ")?\\s*";
    else source += p.text.trim() === "" ? "\\s+" : "\\s*" + escapeRegExp(p.text.trim()) + "\\s*";
  });
  const grammar = new RegExp(source + "$");
  grammars.set(format, grammar);
  return grammar;
}

function toAscii(format: EntryFormat, text: string): string {
  let out = stripMarks(text.normalize("NFKC")).trim();
  format.digits.forEach((digit, n) => {
    if (digit !== String(n)) out = out.split(digit).join(String(n));
  });
  return out.replace(/\s+/g, " ");
}

/** Reads what a person typed or pasted. Only the region's own order is accepted (plus pasted ISO text,
 * which cannot be mistaken for anything else); a day or month the region's order cannot hold is rejected
 * rather than read the other way round. Returns null unless every part is present and the date is real. */
export function parseEntry(format: EntryFormat<"date">, text: string): DateRecord | null;
export function parseEntry(format: EntryFormat<"month">, text: string): MonthRecord | null;
export function parseEntry(format: EntryFormat, text: string): DateRecord | MonthRecord | null {
  const ascii = toAscii(format, text);
  const iso = (format.kind === "date" ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})$/).exec(ascii);
  const values: Partial<Record<Field, number>> = {};
  if (iso) {
    values.year = Number(iso[1]);
    values.month = Number(iso[2]);
    if (format.kind === "date") values.day = Number(iso[3]);
  } else {
    const match = grammarFor(format).exec(ascii);
    if (!match) return null;
    let group = 1;
    for (const p of format.pieces) if (p.kind === "field") values[p.field] = Number(match[group++]);
  }
  const { year, month, day } = values;
  if (!year || !month || month < 1 || month > 12) return null;
  if (format.kind === "month") return { year, month };
  if (!day || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** How the closed field reads: "Oct 4, 2026" or "Oct 2026" in the region's own arrangement. */
export function formatDisplay(locale: string, kind: "date", value: DateRecord): string;
export function formatDisplay(locale: string, kind: "month", value: MonthRecord): string;
export function formatDisplay(locale: string, kind: FieldKind, value: DateRecord | MonthRecord): string {
  const day = kind === "date" ? (value as DateRecord).day : 1;
  const options: Intl.DateTimeFormatOptions = { ...GREGORIAN, year: "numeric", month: "short", ...(kind === "date" ? { day: "numeric" } : {}) };
  return new Intl.DateTimeFormat(locale, options).format(utcDate(value.year, value.month, day));
}

/** A date named in full for assistive technology ("Sunday, October 4, 2026"). */
export function fullDateLabel(locale: string, value: DateRecord): string {
  return new Intl.DateTimeFormat(locale, { ...GREGORIAN, dateStyle: "full" }).format(utcDate(value.year, value.month, value.day));
}

export function monthYearLabel(locale: string, value: MonthRecord): string {
  return new Intl.DateTimeFormat(locale, { ...GREGORIAN, month: "long", year: "numeric" }).format(utcDate(value.year, value.month, 1));
}

export function yearLabel(locale: string, year: number): string {
  return new Intl.NumberFormat(locale, { useGrouping: false }).format(year);
}

export function monthLabels(locale: string): { short: string; long: string }[] {
  const short = new Intl.DateTimeFormat(locale, { ...GREGORIAN, month: "short" });
  const long = new Intl.DateTimeFormat(locale, { ...GREGORIAN, month: "long" });
  return Array.from({ length: 12 }, (_, i) => ({ short: short.format(utcDate(2026, i + 1, 1)), long: long.format(utcDate(2026, i + 1, 1)) }));
}

/** The seven weekday names, starting at `firstDay` (0 = Sunday). */
export function weekdayLabels(locale: string, firstDay: number): { index: number; short: string; long: string }[] {
  const short = new Intl.DateTimeFormat(locale, { ...GREGORIAN, weekday: "short" });
  const long = new Intl.DateTimeFormat(locale, { ...GREGORIAN, weekday: "long" });
  return Array.from({ length: 7 }, (_, i) => {
    const index = (firstDay + i) % 7;
    const sample = utcDate(2023, 1, 1 + index); // 1 January 2023 was a Sunday
    return { index, short: short.format(sample), long: long.format(sample) };
  });
}

/** First day of the week by region, from CLDR's weekData (firstDay "sun", "fri", "sat"; every other
 * region starts on Monday). Used only where the runtime has neither `getWeekInfo()` nor `weekInfo`; the
 * WebView2 runtimes the app supports have one of them. Transcribed from CLDR 44 (2023); recheck against
 * the CLDR release in use when this fallback is revisited. */
const SUNDAY_REGIONS = "AG AS AU BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW".split(" ");
const SATURDAY_REGIONS = "AE AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY".split(" ");

export function firstDayFromRegion(region: string | undefined): number {
  if (!region) return 1;
  if (region === "MV") return 5;
  if (SATURDAY_REGIONS.includes(region)) return 6;
  if (SUNDAY_REGIONS.includes(region)) return 0;
  return 1;
}

/** The first day of the week (0 = Sunday … 6 = Saturday) for a locale. */
export function firstDayOfWeek(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info) return info.firstDay % 7; // Intl numbers Monday 1 … Sunday 7
    return firstDayFromRegion(loc.region ?? loc.maximize().region);
  } catch {
    return 0;
  }
}

const RTL_LANGUAGES = ["ar", "he", "fa", "ur", "ps", "sd", "ug", "yi", "dv", "ckb"];

export function textDirection(locale: string): "ltr" | "rtl" {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getTextInfo?: () => { direction: string }; textInfo?: { direction: string } };
    const info = loc.getTextInfo?.() ?? loc.textInfo;
    if (info) return info.direction === "rtl" ? "rtl" : "ltr";
    return RTL_LANGUAGES.includes(loc.language) ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}
