import { describe, expect, it } from "vitest";
import {
  firstDayFromRegion, firstDayOfWeek, formatDisplay, formatEntry, getEntryFormat, parseEntry, resolveLocale, textDirection,
  weekdayLabels, monthLabels,
} from "./calendarLocale";

const date = (locale: string) => getEntryFormat(locale, "date");
const month = (locale: string) => getEntryFormat(locale, "month");

describe("locale resolution", () => {
  it("uses a valid requested locale, then the browser's languages, then en-US", () => {
    expect(resolveLocale("de-DE", ["fr-FR"])).toBe("de-DE");
    expect(resolveLocale(undefined, ["en-GB", "fr-FR"])).toBe("en-GB");
    expect(resolveLocale("not a locale!", ["ja-JP"])).toBe("ja-JP");
    expect(resolveLocale(undefined, [])).toBe("en-US");
    expect(resolveLocale(undefined, ["", "zz-invalid-xx-"])).toBe("en-US");
  });
});

describe("regional entry formats", () => {
  it("derives each region's order and describes what it accepts", () => {
    expect(date("en-US").hint).toBe("mm/dd/yyyy");
    expect(date("en-GB").hint).toBe("dd/mm/yyyy");
    expect(date("de-DE").hint).toBe("dd.mm.yyyy");
    expect(date("ja-JP").hint).toBe("yyyy/mm/dd");
    expect(month("en-US").hint).toBe("mm/yyyy");
    expect(month("ja-JP").hint).toBe("yyyy/mm");
  });

  it("writes an editing value in the regional order with two-digit day and month", () => {
    const r = { year: 2026, month: 3, day: 9 };
    expect(formatEntry(date("en-US"), r)).toBe("03/09/2026");
    expect(formatEntry(date("en-GB"), r)).toBe("09/03/2026");
    expect(formatEntry(date("de-DE"), r)).toBe("09.03.2026");
    expect(formatEntry(date("ja-JP"), r)).toBe("2026/03/09");
    expect(formatEntry(month("en-US"), { year: 2026, month: 3 })).toBe("03/2026");
  });

  it("reads the same digits as different dates in different regions, never guessing the order", () => {
    expect(parseEntry(date("en-US"), "04/10/2026")).toEqual({ year: 2026, month: 4, day: 10 });
    expect(parseEntry(date("en-GB"), "04/10/2026")).toEqual({ year: 2026, month: 10, day: 4 });
    expect(parseEntry(date("de-DE"), "4.10.2026")).toEqual({ year: 2026, month: 10, day: 4 });
    expect(parseEntry(date("ja-JP"), "2026/10/4")).toEqual({ year: 2026, month: 10, day: 4 });
    // Day 13 is not a US month, and there is no fallback to the other order.
    expect(parseEntry(date("en-US"), "13/10/2026")).toBeNull();
    expect(parseEntry(date("en-GB"), "10/13/2026")).toBeNull();
  });

  it("accepts pasted ISO text as an unambiguous alternative in every region", () => {
    for (const locale of ["en-US", "en-GB", "de-DE", "ja-JP", "ar-EG"]) {
      expect(parseEntry(date(locale), "2026-10-04"), locale).toEqual({ year: 2026, month: 10, day: 4 });
    }
    expect(parseEntry(month("de-DE"), "2026-10")).toEqual({ year: 2026, month: 10 });
  });

  it("requires a full four-digit year and a real, complete date", () => {
    const us = date("en-US");
    for (const bad of ["", "10/04", "10/04/26", "10/04/226", "10/04/20260", "2/30/2026", "02/29/2026", "0/10/2026", "10/04/2026/1", "10/04/2026 extra", "ab/cd/efgh", "10-04-2026x"]) {
      expect(parseEntry(us, bad), bad).toBeNull();
    }
    expect(parseEntry(us, "02/29/2024")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseEntry(month("en-US"), "13/2026")).toBeNull();
    expect(parseEntry(month("en-US"), "10/2026")).toEqual({ year: 2026, month: 10 });
  });

  it("ignores surrounding whitespace and direction marks, and accepts the region's separators", () => {
    expect(parseEntry(date("en-US"), "  10/04/2026 ")).toEqual({ year: 2026, month: 10, day: 4 });
    expect(parseEntry(date("en-US"), "\u200e10/04/2026\u200f")).toEqual({ year: 2026, month: 10, day: 4 });
    expect(parseEntry(date("en-US"), "10.04.2026")).toBeNull();
  });

  it("maps a region's own digits as well as ASCII, in a right-to-left locale", () => {
    const ar = date("ar-EG");
    const written = formatEntry(ar, { year: 2026, month: 10, day: 4 });
    expect(written).toMatch(/[\u0660-\u0669]/);
    expect(parseEntry(ar, written)).toEqual({ year: 2026, month: 10, day: 4 });
    expect(parseEntry(ar, "٠٤/١٠/٢٠٢٦")).toEqual({ year: 2026, month: 10, day: 4 });
    expect(parseEntry(ar, "04/10/2026")).toEqual({ year: 2026, month: 10, day: 4 });
    expect(textDirection("ar-EG")).toBe("rtl");
    expect(textDirection("en-US")).toBe("ltr");
  });

  it("tolerates a region's trailing punctuation", () => {
    const ko = date("ko-KR");
    const written = formatEntry(ko, { year: 2026, month: 10, day: 4 });
    expect(parseEntry(ko, written)).toEqual({ year: 2026, month: 10, day: 4 });
    expect(parseEntry(ko, "2026. 10. 4")).toEqual({ year: 2026, month: 10, day: 4 });
  });
});

describe("closed-field display", () => {
  it("writes the date or month the regional way, with the year", () => {
    expect(formatDisplay("en-US", "date", { year: 2026, month: 10, day: 4 })).toBe("Oct 4, 2026");
    expect(formatDisplay("en-GB", "date", { year: 2026, month: 10, day: 4 })).toBe("4 Oct 2026");
    expect(formatDisplay("en-US", "month", { year: 2026, month: 10 })).toBe("Oct 2026");
    expect(formatDisplay("en-US", "date", { year: 1900, month: 1, day: 1 })).toBe("Jan 1, 1900");
  });
});

describe("week and names", () => {
  it("uses the region's first day of the week", () => {
    expect(firstDayOfWeek("en-US")).toBe(0);
    expect(firstDayOfWeek("en-GB")).toBe(1);
    expect(firstDayOfWeek("de-DE")).toBe(1);
    expect(firstDayOfWeek("ar-EG")).toBe(6);
  });

  it("falls back to a region table that covers regions without assuming Monday", () => {
    expect([firstDayFromRegion("US"), firstDayFromRegion("GB"), firstDayFromRegion("EG"), firstDayFromRegion("MV"), firstDayFromRegion("IN"), firstDayFromRegion("ZZ"), firstDayFromRegion(undefined)]).toEqual([0, 1, 6, 5, 0, 1, 1]);
  });

  it("lists weekday and month names in order, starting at the week's first day", () => {
    expect(weekdayLabels("en-US", 0).map((w) => w.short)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(weekdayLabels("en-GB", 1)[0].long).toBe("Monday");
    const months = monthLabels("en-US");
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ short: "Jan", long: "January" });
    expect(months[11].long).toBe("December");
  });
});
