"""Move named Rust items between files verbatim, and fingerprint sets of items to prove a move changed nothing.

Written for splitting core/src/store.rs into feature modules (docs/superpowers/plans/2026-10-02-split-store-rs.md).
It is line based and expects rustfmt-formatted input; a small lexer counts braces correctly past strings,
chars and comments.

  python tools/split_rust_items.py move --mapping MAP.json --step NAME
  python tools/split_rust_items.py fingerprint --out FILE SRC...
  python tools/split_rust_items.py compare BEFORE AFTER

An "item" is a top-level item (struct, enum, fn, const, impl block, use, mod…) or, inside the containers
`impl Store { … }` and `mod tests { … }`, one member of the container. Doc comments and attributes directly
above an item (no blank line between) belong to it. A comment block with blank lines around it is an item
of its own.
"""

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

CONTAINER_RE = re.compile(r"^\s*(impl Store|(pub(\([a-z]+\))? )?mod tests)\s*\{\s*$")
NAME_RES = [
    (re.compile(r"\bfn\s+(\w+)"), "fn"),
    (re.compile(r"^\s*(pub(\([^)]*\))?\s+)?struct\s+(\w+)"), "struct"),
    (re.compile(r"^\s*(pub(\([^)]*\))?\s+)?enum\s+(\w+)"), "enum"),
    (re.compile(r"^\s*(pub(\([^)]*\))?\s+)?(const|static)\s+(\w+)"), "const"),
    (re.compile(r"^\s*(pub(\([^)]*\))?\s+)?type\s+(\w+)"), "type"),
    (re.compile(r"^\s*impl(<[^>]*>)?\s+(.+?\s+for\s+)?([\w:]+)"), "impl"),
]
# a `use`/`mod` declaration (any indent), and one at the start of a line
TOP_DECL_RE = re.compile(r"^(pub(\([^)]*\))?\s+)?(use|mod)\s")
CHAR_RE = re.compile(r"'(\\(u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'])'")
RAW_START_RE = re.compile(r'[bc]?r(#*)"')


def brace_delta(line, state):
    """Net `{` minus `}` on `line`, skipping strings, raw strings, char literals and comments.
    `state` carries an open block comment or string from one line to the next and is updated in place;
    `state["code"]` is left holding the line up to any `//` comment that starts outside a literal."""
    delta, i, n = 0, 0, len(line)
    state["code"] = line.rstrip("\r\n")
    state["opens"] = 0
    while i < n:
        mode = state.get("mode")
        c = line[i]
        if mode == "block":
            if line.startswith("*/", i):
                state["depth"] -= 1
                if state["depth"] == 0:
                    state["mode"] = None
                i += 2
            elif line.startswith("/*", i):
                state["depth"] += 1
                i += 2
            else:
                i += 1
            continue
        if mode == "str":
            if c == "\\":
                i += 2
                continue
            if c == '"':
                state["mode"] = None
            i += 1
            continue
        if mode == "raw":
            end = '"' + "#" * state["hashes"]
            if line.startswith(end, i):
                state["mode"] = None
                i += len(end)
            else:
                i += 1
            continue
        if line.startswith("//", i):
            state["code"] = line[:i]
            break
        if line.startswith("/*", i):
            state["mode"], state["depth"] = "block", 1
            i += 2
            continue
        m = RAW_START_RE.match(line, i)
        if m and (i == 0 or not (line[i - 1].isalnum() or line[i - 1] == "_")):
            state["mode"], state["hashes"] = "raw", len(m.group(1))
            i = m.end()
            continue
        if c == '"':
            state["mode"] = "str"
            i += 1
            continue
        if c == "'":
            m = CHAR_RE.match(line, i)
            i = m.end() if m else i + 1  # no match: a lifetime
            continue
        if c == "{":
            delta += 1
            state["opens"] += 1
        elif c == "}":
            delta -= 1
        i += 1
    return delta


def is_trivia(stripped):
    return stripped.startswith("//") or stripped.startswith("#[") or stripped.startswith("#![")


def first_code_line(text_lines):
    """The first line that is neither a comment nor part of an attribute (which may span several lines)."""
    attr_depth = 0
    for l in text_lines:
        s = l.strip()
        if attr_depth > 0 or s.startswith(("#[", "#![")):
            attr_depth += s.count("[") - s.count("]")
            continue
        if s and not s.startswith("//"):
            return l
    return ""


def item_name(text_lines):
    line = first_code_line(text_lines)
    if not line:
        return "comment", text_lines[0].strip()[:40] if text_lines else ""
    for rx, kind in NAME_RES:
        m = rx.search(line)
        if m:
            return kind, m.groups()[-1].split("::")[-1]
    return "other", line.strip()[:40]


def parse_items(lines):
    """Split `lines` into items: dicts with start, end (exclusive line indexes), kind, name and container
    (None at top level, else the container's opening line, stripped)."""
    items = []
    state = {}

    def walk(start, end, container):
        i = start
        while i < end:
            if not lines[i].strip():
                i += 1
                continue
            j = i  # skip leading comments/attributes
            while j < end and lines[j].strip() and is_trivia(lines[j].strip()):
                j += 1
            if j >= end or not lines[j].strip():
                items.append(dict(start=i, end=j, kind="comment", name=lines[i].strip()[:40], container=container))
                i = j
                continue
            if CONTAINER_RE.match(lines[j]) and all(lines[k].strip().startswith("#[") for k in range(i, j)):
                depth, k = brace_delta(lines[j], state), j
                while depth > 0:
                    k += 1
                    depth += brace_delta(lines[k], state)
                walk(j + 1, k, lines[j].strip())
                i = k + 1
                continue
            depth, k, opened = 0, j, False
            while k < end:
                depth += brace_delta(lines[k], state)
                opened = opened or depth > 0 or state["opens"] > 0
                code = state["code"].rstrip()
                if depth == 0 and ((opened and code.endswith(("}", "};", "},"))) or (not opened and code.endswith(";"))):
                    break
                k += 1
            kind, name = item_name(lines[i : k + 1])
            items.append(dict(start=i, end=k + 1, kind=kind, name=name, container=container))
            i = k + 1

    walk(0, len(lines), None)
    return items


def write_atomic(path, text):
    """Write via a temp file in the same folder and swap it in, so a failure leaves the old file whole."""
    path = Path(path)
    tmp = path.with_name(path.name + ".split-tmp")
    tmp.write_text(text, encoding="utf-8", newline="")
    try:
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def read_lines(path):
    # newline="" keeps CRLF as written, so a CRLF file is written back as CRLF
    return Path(path).read_text(encoding="utf-8", newline="").splitlines(keepends=True)


def newline_of(lines):
    return "\r\n" if lines and lines[0].endswith("\r\n") else "\n"


IDENT_RE = re.compile(r"[A-Za-z0-9_]+")
LIFETIME_RE = re.compile(r"'[A-Za-z_]\w*")
CLOSERS = {")", "]", "}", ">"}


def tokenize(text):
    """Rust source as tokens: string, raw-string and char literals verbatim (whitespace inside them counts),
    comments as one token each (a block comment's whitespace runs collapsed), identifiers/numbers, and
    single punctuation characters. Whitespace between tokens is dropped."""
    toks, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c.isspace():
            i += 1
            continue
        if text.startswith("//", i):
            j = text.find("\n", i)
            j = n if j < 0 else j
            toks.append(text[i:j].rstrip())
            i = j
            continue
        if text.startswith("/*", i):
            depth, j = 0, i
            while j < n:
                if text.startswith("/*", j):
                    depth, j = depth + 1, j + 2
                elif text.startswith("*/", j):
                    depth, j = depth - 1, j + 2
                    if depth == 0:
                        break
                else:
                    j += 1
            toks.append(re.sub(r"\s+", " ", text[i:j]))
            i = j
            continue
        m = RAW_START_RE.match(text, i)
        if m:
            end = '"' + "#" * len(m.group(1))
            j = text.find(end, m.end())
            j = n if j < 0 else j + len(end)
            toks.append(text[i:j])
            i = j
            continue
        if c == '"' or text.startswith(('b"', 'c"'), i):
            j = i + (1 if c == '"' else 2)
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            toks.append(text[i : j + 1])
            i = j + 1
            continue
        if c == "'" or text.startswith("b'", i):
            m = CHAR_RE.match(text, i + (1 if c == "b" else 0))
            if m:
                toks.append(text[i : m.end()])
                i = m.end()
                continue
            m = LIFETIME_RE.match(text, i)
            if m:
                toks.append(m.group(0))
                i = m.end()
                continue
        m = IDENT_RE.match(text, i)
        if m:
            toks.append(m.group(0))
            i = m.end()
            continue
        toks.append(c)
        i += 1
    return toks


def normalize(text):
    """What a pure move may not change: every token, literals verbatim. Allowed to differ: whitespace between
    tokens (indentation, rustfmt reflow), a trailing comma before a closing bracket (rustfmt adds and drops
    those when it reflows), and `pub(super)` (a moved item may need it)."""
    toks = tokenize(text)
    out, i = [], 0
    while i < len(toks):
        if toks[i : i + 4] == ["pub", "(", "super", ")"]:
            i += 4
            continue
        if toks[i] == "," and i + 1 < len(toks) and toks[i + 1] in CLOSERS:
            i += 1
            continue
        out.append(toks[i])
        i += 1
    return "\x1f".join(out)


def is_declaration(text):
    """True when `text` is only a `use`/`mod x;` statement (plus attributes and comments), not code."""
    toks = [t for t in tokenize(text) if not t.startswith(("//", "/*"))]
    while toks[:2] == ["#", "["]:  # leading attributes
        depth, k = 0, 1
        for k in range(1, len(toks)):
            depth += {"[": 1, "]": -1}.get(toks[k], 0)
            if depth == 0:
                break
        toks = toks[k + 1 :]
    if toks[:1] == ["pub"]:
        toks = toks[4:] if toks[1:2] == ["("] else toks[1:]
    if toks[:1] not in (["use"], ["mod"]) or toks[-1:] != [";"]:
        return False
    depth = 0
    for t in toks[:-1]:
        depth += {"{": 1, "}": -1}.get(t, 0)
        if t == ";" and depth == 0:
            return False  # a second statement follows
    return not (toks[0] == "mod" and "{" in toks)


def fingerprint(paths):
    """(Counter of item hashes, {hash: label}) over `paths`. Each item is hashed with whether it sits inside
    `impl Store`, so a method that drifts out of its impl counts as changed. Left out: pure use/mod
    declarations and blocks made only of `//!` module docs, which a split rewrites by design."""
    counts, labels = Counter(), {}
    for p in paths:
        lines = read_lines(p)
        for it in parse_items(lines):
            body = "".join(lines[it["start"] : it["end"]])
            toks = tokenize(body)
            if is_declaration(body) or (toks and all(t.startswith("//!") for t in toks)):
                continue
            where = "impl" if it["container"] and it["container"].startswith("impl") else "item"
            h = hashlib.sha1((where + "\x1e" + normalize(body)).encode("utf-8")).hexdigest()[:12]
            counts[h] += 1
            labels[h] = f"{it['kind']} {it['name']}"
    return counts, labels


def find_items(lines, names, container_kind):
    """Items whose name is in `names` ("*" = every item). container_kind: "impl" (inside impl Store),
    "tests" (inside mod tests) or "top" (top level). A top-level name also matches its `impl X` blocks."""
    out = []
    for it in parse_items(lines):
        c = it["container"]
        if container_kind == "impl" and not (c and c.startswith("impl")):
            continue
        if container_kind == "tests" and not (c and "mod tests" in c):
            continue
        if container_kind == "top" and c is not None:
            continue
        if "*" in names or it["name"] in names:
            out.append(it)
    return out


def starts_inside_literal(text_lines):
    """For each line, whether it begins inside a multi-line string or raw string (its leading whitespace is
    part of the literal and must not be touched)."""
    state, flags = {}, []
    for l in text_lines:
        flags.append(state.get("mode") in ("str", "raw"))
        brace_delta(l, state)
    return flags


def reindent(text_lines, remove, add):
    out = []
    for l, inside in zip(text_lines, starts_inside_literal(text_lines)):
        if inside:
            out.append(l)
            continue
        if not l.strip():
            out.append(l.lstrip(" "))
            continue
        if remove and l.startswith(" " * remove):
            l = l[remove:]
        out.append(" " * add + l if add else l)
    return out


def impl_close(lines):
    """Index of the line closing the first `impl Store {` block in `lines`."""
    start = next(i for i, l in enumerate(lines) if l.startswith("impl Store"))
    state, depth = {}, 0
    for k in range(start, len(lines)):
        depth += brace_delta(lines[k], state)
        if depth == 0 and k > start:
            return k
    sys.exit("no closing `}` for `impl Store {`")


def move(src, dest, names, where, container_kind, header=None):
    """Cut the named items out of `src` and add them to `dest`, in source order.
    where: "end" (append), "impl" (before the closing `}` of dest's `impl Store {` block) or
    "before-impl" (just above dest's `impl Store {` line). A missing dest is created from `header`.
    Returns (moved names, names of moved top-level `pub` items)."""
    src_lines = read_lines(src)
    found = find_items(src_lines, set(names), container_kind)
    missing = sorted(set(names) - {it["name"] for it in found} - {"*"})
    if missing:
        sys.exit(f"{src}: not found: {', '.join(missing)}")
    nl = newline_of(src_lines)
    block, drop = [], set()
    for it in found:
        body = src_lines[it["start"] : it["end"]]
        body = reindent(body, 4 if it["container"] else 0, 4 if where == "impl" else 0)
        block.append(nl)
        block.extend(body)
        drop.update(range(it["start"], it["end"]))
        if it["end"] < len(src_lines) and not src_lines[it["end"]].strip():
            drop.add(it["end"])  # and the blank line after it, so gaps don't pile up
    dest_path = Path(dest)
    if dest_path.exists():
        dest_lines = read_lines(dest)
    elif header is None:
        sys.exit(f"{dest} does not exist and the step gives no header")
    else:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_lines = [l + nl for l in header]
    if where == "end":
        dest_lines.extend(block)
    elif where == "before-impl":
        idx = next(i for i, l in enumerate(dest_lines) if l.startswith("impl Store"))
        dest_lines[idx:idx] = block[1:] + [nl]
    else:
        idx = impl_close(dest_lines)
        dest_lines[idx:idx] = block
    # destination first: if it can't be written, the source still has the code
    write_atomic(dest_path, "".join(dest_lines))
    write_atomic(Path(src), "".join(l for i, l in enumerate(src_lines) if i not in drop))
    pub_names = [
        it["name"]
        for it in found
        if it["container"] is None
        and it["kind"] in ("struct", "enum", "const", "type", "fn")
        and first_code_line(src_lines[it["start"] : it["end"]]).startswith("pub ")
    ]
    return [it["name"] for it in found], pub_names


def leading_decls_end(lines):
    """Line index just past the leading run of top-level use/mod declarations (whole items, so a `pub use`
    that rustfmt wrapped over several lines counts to its closing `};`)."""
    end = 0
    for it in parse_items(lines):
        if it["container"] is not None or it["kind"] == "comment":
            continue
        if not TOP_DECL_RE.match(first_code_line(lines[it["start"] : it["end"]])):
            break
        end = it["end"]
    return end


def register(parent, stem, pub_names):
    """Declare `mod stem;` in `parent` after its leading use/mod declarations (once), and re-export `pub_names`."""
    lines = read_lines(parent)
    nl = newline_of(lines)
    decl = f"mod {stem};{nl}"
    if decl not in lines:
        lines.insert(leading_decls_end(lines), decl)
    if pub_names:
        lines.insert(lines.index(decl) + 1, f"pub use self::{stem}::{{{', '.join(sorted(pub_names))}}};{nl}")
    Path(parent).write_text("".join(lines), encoding="utf-8", newline="")


def collapse_tests_shell(path):
    """Replace the emptied `#[cfg(test)] mod tests { }` in `path` with `#[cfg(test)] mod tests;`."""
    text = Path(path).read_text(encoding="utf-8")
    new_text, n = re.subn(r"#\[cfg\(test\)\](\r?\n)mod tests \{\s*\}", r"#[cfg(test)]\1mod tests;", text)
    if n != 1:
        sys.exit(f"{path}: could not find the emptied `mod tests {{ }}`")
    Path(path).write_text(new_text, encoding="utf-8", newline="")


def cmd_move(args):
    mapping = json.loads(Path(args.mapping).read_text(encoding="utf-8"))
    for group in mapping[args.step]:
        moved, pub_names = move(group["src"], group["dest"], group["items"], group["where"], group["from"], group.get("header"))
        print(f"{group['src']} -> {group['dest']}: {len(moved)} items")
        if group.get("collapse_tests_shell"):
            collapse_tests_shell(group["src"])
            print(f"  {group['src']}: mod tests {{ … }} is now mod tests;")
        if "register" in group:
            exported = pub_names if group.get("reexport") else []
            register(group["register"], Path(group["dest"]).stem, exported)
            print(f"  {group['register']}: mod {Path(group['dest']).stem};" + (f" + pub use of {len(exported)}" if exported else ""))


def cmd_fingerprint(args):
    counts, labels = fingerprint(args.files)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        for h in sorted(counts):
            f.write(f"{h} {counts[h]} {labels[h]}\n")
    print(f"{sum(counts.values())} items -> {args.out}")


def cmd_compare(args):
    def load(p):
        return Counter({l.split()[0]: int(l.split()[1]) for l in Path(p).read_text(encoding="utf-8").splitlines() if l.strip()})

    before, after = load(args.before), load(args.after)
    if before == after:
        print(f"identical: {sum(before.values())} items")
        return
    labels = {l.split()[0]: " ".join(l.split()[2:]) for p in (args.before, args.after) for l in Path(p).read_text(encoding="utf-8").splitlines()}
    for h in sorted(set(before) | set(after)):
        if before[h] != after[h]:
            print(f"{'lost' if before[h] > after[h] else 'new '} {labels[h]} ({h})")
    sys.exit(1)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(required=True)
    m = sub.add_parser("move")
    m.add_argument("--mapping", required=True)
    m.add_argument("--step", required=True)
    m.set_defaults(fn=cmd_move)
    f = sub.add_parser("fingerprint")
    f.add_argument("--out", required=True)
    f.add_argument("files", nargs="+")
    f.set_defaults(fn=cmd_fingerprint)
    c = sub.add_parser("compare")
    c.add_argument("before")
    c.add_argument("after")
    c.set_defaults(fn=cmd_compare)
    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
