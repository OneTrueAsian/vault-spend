// Reads the text out of a PDF that WebView2 (Skia) wrote: Flate content streams, Type0 fonts with a ToUnicode map and
// hex-string glyph codes. Not a general PDF reader; enough to check which words a saved report holds.
import zlib from "node:zlib";

function streams(buffer) {
  const text = buffer.toString("latin1");
  const found = [];
  const objects = /(\d+) \d+ obj\b/g;
  let match;
  const starts = [];
  while ((match = objects.exec(text))) starts.push({ id: Number(match[1]), at: match.index + match[0].length });
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].at : text.length;
    const body = text.slice(starts[i].at, end);
    const open = body.search(/stream\r?\n/);
    let data = null;
    let dict = body;
    if (open >= 0) {
      dict = body.slice(0, open);
      const from = starts[i].at + open + body.slice(open).match(/stream\r?\n/)[0].length;
      const to = text.indexOf("endstream", from);
      let raw = buffer.subarray(from, to);
      if (/\/FlateDecode/.test(dict)) {
        try { raw = zlib.inflateSync(raw); } catch { raw = null; }
      }
      data = raw;
    }
    found.push({ id: starts[i].id, dict, data });
  }
  return found;
}

function parseCMap(source) {
  const map = new Map();
  const hex = (h) => String.fromCodePoint(...(h.match(/.{4}/g) ?? []).map((u) => parseInt(u, 16)));
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, dest] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(code, 16), hex(dest.padStart(4, "0")));
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, dest] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const start = parseInt(dest, 16);
      for (let c = parseInt(lo, 16); c <= parseInt(hi, 16); c++) map.set(c, String.fromCodePoint(start + c - parseInt(lo, 16)));
    }
  }
  return map;
}

/** The text of every page, in drawing order, one string per page. */
export function pdfPages(buffer) {
  const objs = streams(buffer);
  const byId = new Map(objs.map((o) => [o.id, o]));
  const cmaps = new Map(); // font object id -> code map
  for (const o of objs) {
    const to = /\/ToUnicode (\d+) 0 R/.exec(o.dict);
    if (!to || !/\/Type ?\/Font/.test(o.dict)) continue;
    const cm = byId.get(Number(to[1]));
    if (cm?.data) cmaps.set(o.id, parseCMap(cm.data.toString("latin1")));
  }
  // Skia numbers its fonts across the document (/F4, /F5 ...), and each resource dictionary names the font objects.
  const fontByName = new Map();
  for (const o of objs) for (const [, name, id] of o.dict.matchAll(/\/(F\d+) (\d+) 0 R/g)) if (cmaps.has(Number(id))) fontByName.set(name, cmaps.get(Number(id)));
  const pages = [];
  for (const o of objs) {
    if (!o.data || /\/Type ?\/(Font|FontDescriptor|ObjStm)|\/Length1|\/FunctionType|\/ShadingType/.test(o.dict) || /\/Subtype ?\/Image/.test(o.dict)) continue;
    const content = o.data.toString("latin1");
    if (!/BT[\s\S]*?ET/.test(content)) continue;
    let font = null;
    let out = "";
    for (const token of content.matchAll(/\/(F\d+) [\d.]+ Tf|<([0-9a-fA-F]+)> ?Tj|\[((?:[^\]]*))\] ?TJ|\bET\b/g)) {
      if (token[1]) font = fontByName.get(token[1]) ?? null;
      else if (token[2] !== undefined || token[3] !== undefined) {
        const holes = token[2] !== undefined ? [token[2]] : [...token[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => m[1]);
        for (const h of holes) for (const code of h.match(/.{4}/g) ?? []) out += font?.get(parseInt(code, 16)) ?? "";
      } else out += " ";
    }
    if (out.trim()) pages.push(out);
  }
  return pages;
}

export function pdfText(buffer) {
  return pdfPages(buffer).join("\n");
}
