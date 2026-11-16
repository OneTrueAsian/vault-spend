import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { pdfPages, pdfText } from "./pdfText.mjs";

// A tiny PDF built the way WebView2 writes them: Type0 fonts with a ToUnicode map, glyph codes as hex strings and Flate streams.
function pdf({ cmap, content, fontName = "F4" }) {
  const deflated = (text) => zlib.deflateSync(Buffer.from(text, "latin1"));
  const parts = [];
  const obj = (id, dict, stream) => {
    parts.push(Buffer.from(`${id} 0 obj\n<<${dict}${stream ? `\n/Filter /FlateDecode\n/Length ${stream.length}` : ""}>>`, "latin1"));
    if (stream) parts.push(Buffer.from("\nstream\n", "latin1"), stream, Buffer.from("\nendstream", "latin1"));
    parts.push(Buffer.from("\nendobj\n", "latin1"));
  };
  obj(1, "/Type /Font\n/Subtype /Type0\n/ToUnicode 2 0 R");
  obj(2, "", deflated(cmap));
  obj(3, `/Resources <</Font <</${fontName} 1 0 R>>>>`, deflated(content));
  return Buffer.concat([Buffer.from("%PDF-1.4\n", "latin1"), ...parts]);
}

const CMAP = "beginbfchar <0001> <0048> <0002> <0069> endbfchar beginbfrange <0003> <0005> <0041> endbfrange";

describe("pdfText", () => {
  it("reads a hex string shown with Tj through the font's ToUnicode map", () => {
    expect(pdfText(pdf({ cmap: CMAP, content: "BT /F4 12 Tf <00010002> Tj ET" })).trim()).toBe("Hi");
  });

  it("reads TJ arrays, skipping the spacing numbers, and bfrange runs", () => {
    expect(pdfText(pdf({ cmap: CMAP, content: "BT /F4 12 Tf [<0001> -20 <0002> 5 <000300040005>] TJ ET" })).trim()).toBe("HiABC");
  });

  it("starts a new run after each text object, so words from separate blocks do not run together", () => {
    const text = pdfText(pdf({ cmap: CMAP, content: "BT /F4 12 Tf <0001> Tj ET BT /F4 12 Tf <0002> Tj ET" }));
    expect(text.replace(/\s+/g, " ").trim()).toBe("H i");
  });

  it("returns nothing for a stream without text, and one entry per stream with text", () => {
    expect(pdfPages(pdf({ cmap: CMAP, content: "q 1 0 0 1 0 0 cm Q" }))).toEqual([]);
    expect(pdfPages(pdf({ cmap: CMAP, content: "BT /F4 12 Tf <0001> Tj ET" }))).toHaveLength(1);
  });
});
