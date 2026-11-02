import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { blend, contrastRatio, decodePng, measureElement, pixelAt } from "./calendarContrast.mjs";

function crc(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crcv = 0xffffffff;
  for (const byte of buf) crcv = table[(crcv ^ byte) & 255] ^ (crcv >>> 8);
  return (crcv ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}
/** Builds a PNG from rows of RGB(A) pixels, each row using the given filter type, to exercise the decoder. */
function png(rows, channels, filters) {
  const width = rows[0].length / channels;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(rows.length, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const lines = rows.map((row, y) => {
    const filter = filters[y % filters.length];
    const out = Buffer.alloc(row.length + 1);
    out[0] = filter;
    for (let x = 0; x < row.length; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = y > 0 ? rows[y - 1][x] : 0;
      const upLeft = y > 0 && x >= channels ? rows[y - 1][x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[x + 1] = (row[x] - predicted) & 255;
    }
    return out;
  });
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(lines))), chunk("IEND", Buffer.alloc(0))]);
}

describe("decodePng", () => {
  const rows = [
    [10, 20, 30, 200, 210, 220, 5, 6, 7],
    [11, 22, 33, 190, 180, 170, 9, 8, 7],
    [250, 1, 2, 3, 4, 5, 100, 101, 102],
    [0, 0, 0, 255, 255, 255, 128, 64, 32],
    [77, 78, 79, 80, 81, 82, 83, 84, 85],
  ];
  it("reads every filter type back exactly", () => {
    const image = decodePng(png(rows, 3, [0, 1, 2, 3, 4]));
    expect(image.width).toBe(3);
    expect(image.height).toBe(5);
    rows.forEach((row, y) => [0, 1, 2].forEach((x) => expect([...pixelAt(image, x, y)]).toEqual(row.slice(x * 3, x * 3 + 3))));
  });
  it("reads RGBA and keeps the colour channels", () => {
    const image = decodePng(png([[1, 2, 3, 255, 4, 5, 6, 128]], 4, [4]));
    expect([...pixelAt(image, 1, 0)]).toEqual([4, 5, 6]);
  });
  it("refuses something that is not a PNG", () => {
    expect(() => decodePng(Buffer.from("nope nope nope"))).toThrow("not a PNG");
  });
});

describe("contrast arithmetic", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2);
    expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
    expect(contrastRatio([10, 10, 10], [10, 10, 10])).toBe(1);
  });
  it("blends a translucent foreground over the background it is on", () => {
    expect(blend([0, 0, 0], 0.5, [200, 100, 50])).toEqual([100, 50, 25]);
    expect(blend([9, 9, 9], 1, [200, 100, 50])).toEqual([9, 9, 9]);
  });
});

describe("measureElement", () => {
  const image = decodePng(png([[255, 255, 255, 255, 255, 255, 40, 40, 40, 40, 40, 40]], 3, [0]));
  const viewport = { width: 4, height: 1 };
  const element = (extra) => ({ describe: { name: "x" }, rgb: [118, 118, 118], alpha: 1, graphic: false, exempt: false, points: [[0.5, 0.5], [2.5, 0.5]], ...extra });
  it("reports the worst sampled background, not the best", () => {
    const m = measureElement(image, viewport, element());
    expect(m.background).toEqual([40, 40, 40]);
    expect(m.ratio).toBeLessThan(4.5);
    expect(m.passes).toBe(false);
  });
  it("passes when every sample reaches the threshold and uses 3:1 for graphics", () => {
    expect(measureElement(image, viewport, element({ points: [[0.5, 0.5]] })).passes).toBe(true);
    expect(measureElement(image, viewport, element({ rgb: [140, 140, 140], points: [[0.5, 0.5], [2.5, 0.5]], graphic: true })).threshold).toBe(3);
  });
  it("applies a foreground's own transparency", () => {
    const faint = measureElement(image, viewport, element({ rgb: [0, 0, 0], alpha: 0.1, points: [[0.5, 0.5]] }));
    expect(faint.ratio).toBeLessThan(2);
  });
  it("reports a disabled control without holding it to a threshold", () => {
    const m = measureElement(image, viewport, element({ exempt: true }));
    expect(m.threshold).toBeNull();
    expect(m.passes).toBeNull();
  });
});
