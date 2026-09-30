// The legal notice ships as docs/LEGAL-NOTICE.md, which the app bundles. This reads the small subset of
// Markdown that file uses (headings, paragraphs, bullet lists, **bold**, `code`) so the app can show it
// without a Markdown library. It throws on a file missing a header or section, so a malformed notice
// fails a test, not a person's first launch.

import legalNoticeSource from "../docs/LEGAL-NOTICE.md?raw";

export type NoticeBlock =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

export interface ParsedLegalNotice {
  /** The date-shaped version id, compared as a plain string. */
  version: string;
  whatChanged: string;
  summary: NoticeBlock[];
  full: NoticeBlock[];
}

export type InlinePiece = { kind: "text" | "bold" | "code"; text: string };

function header(lines: string[], label: string): string {
  const prefix = `**${label}:**`;
  const line = lines.find((l) => l.trim().startsWith(prefix));
  const value = line?.trim().slice(prefix.length).trim();
  if (!value) throw new Error(`The legal notice has no "${label}" line.`);
  return value;
}

function blocks(lines: string[]): NoticeBlock[] {
  const out: NoticeBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (paragraph.length) out.push({ kind: "paragraph", text: paragraph.join(" ") });
    if (list) out.push({ kind: "list", items: list });
    paragraph = [];
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "" || line === "---") {
      flush();
    } else if (line.startsWith("### ") || line.startsWith("## ")) {
      flush();
      const level = line.startsWith("### ") ? 3 : 2;
      out.push({ kind: "heading", level, text: line.slice(level + 1).trim() });
    } else if (line.startsWith("- ")) {
      if (paragraph.length) {
        out.push({ kind: "paragraph", text: paragraph.join(" ") });
        paragraph = [];
      }
      (list ??= []).push(line.slice(2).trim());
    } else {
      if (list) {
        out.push({ kind: "list", items: list });
        list = null;
      }
      paragraph.push(line);
    }
  }
  flush();
  return out;
}

export function parseLegalNotice(raw: string): ParsedLegalNotice {
  const lines = raw.split(/\r?\n/);
  const summaryAt = lines.findIndex((l) => l.trim() === "## SUMMARY");
  if (summaryAt < 0) throw new Error('The legal notice has no "## SUMMARY" section.');
  const fullAt = lines.findIndex((l) => l.trim() === "# FULL NOTICE");
  if (fullAt < 0) throw new Error('The legal notice has no "# FULL NOTICE" section.');
  const top = lines.slice(0, summaryAt);
  return {
    version: header(top, "Version"),
    whatChanged: header(top, "What changed"),
    summary: blocks(lines.slice(summaryAt + 1, fullAt)),
    full: blocks(lines.slice(fullAt + 1)),
  };
}

/** The notice bundled with this build, parsed once. A malformed file fails the legalNotice tests. */
export const bundledLegalNotice: ParsedLegalNotice = parseLegalNotice(legalNoticeSource);

export function parseInline(text: string): InlinePiece[] {
  const pieces: InlinePiece[] = [];
  const pattern = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) pieces.push({ kind: "text", text: text.slice(last, match.index) });
    pieces.push(match[1] !== undefined ? { kind: "bold", text: match[1] } : { kind: "code", text: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) pieces.push({ kind: "text", text: text.slice(last) });
  return pieces;
}
