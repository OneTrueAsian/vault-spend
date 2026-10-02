# Split `core/src/store.rs` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 21,115-line `core/src/store.rs` into 16 feature modules plus per-feature test files, with no behavior or public API change.

**Architecture:** A small Python tool (`tools/split_rust_items.py`) cuts named items out of one file and pastes them, unchanged, into another, driven by a checked-in mapping (`docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json`). The same tool fingerprints every item so each step can prove that nothing was edited. Each step then adds `use` lines, widens a few private items to `pub(super)`, and goes through the full Rust gate before its own commit.

**Tech Stack:** Rust 2024 (`budget_core` crate, rusqlite, rust_decimal, chrono), Python 3.14 standard library (`unittest`, no pytest), cargo fmt/clippy.

**Spec:** `docs/superpowers/specs/2026-10-02-split-store-rs-design.md`

**Dry run:** the whole plan was rehearsed on a scratch copy of `core/` at `6d2e981`. All 17 moves ran, the fingerprint matched the baseline (1,099 items), `cargo test -p budget_core` passed (741 lib + 180 comparisons + integration tests) and clippy `-D warnings` was clean. The import lists and `pub(super)` changes below are exactly what that run needed.

## Global Constraints

- No behavior change and no public API change: every `budget_core::store::X` path that compiles today still compiles, in `core`, `src-tauri`, `core/tests` and `core/examples`.
- Items are moved by the tool, never retyped. The only hand edits are `use` lines, `pub(super)` on the items each task names, and removing imports that the compiler reports as unused.
- Nothing becomes newly `pub`. Widening goes only to `pub(super)`.
- Rust test count is unchanged: `cargo test -p budget_core --lib` reports **741 passed** after every task.
- After every task, the fingerprint `compare` against the baseline prints `identical: 1099 items`.
- Each file keeps its line endings. `store.rs` is LF in the working tree, and new files follow it (git's LF→CRLF warning is expected and harmless).
- Builds use `$env:CARGO_TARGET_DIR = "$env:TEMP\vs-verify-target"` (the owner's running app may lock `target\debug`). Run cargo from **PowerShell**, not Git Bash, because the OpenSSL build needs Strawberry Perl.
- One commit per task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Out of scope: `commands.rs`, `App.tsx`, `App.css`, renaming anything, and fixing anything noticed along the way (write it down for the final report instead).

## Review Focus

- **A test that silently stops running.** If a test module is not declared with `mod`, its tests vanish without an error. Guard: the 741-passed count in every task's gate.
- **An edited line hidden inside a move.** A stray keystroke changes a number or a condition. Guard: the fingerprint compare in every task's gate, which notices any change except whitespace, commas and `pub(super)`.
- **`src-tauri` loses a type path.** A moved `pub` type without a re-export breaks the app shell. Guard: `cargo clippy --workspace --all-targets` in every task's gate, and the tool writes the `pub use` line itself.
- **Non-ASCII text mangled.** Comments contain em dashes; a wrong encoding would corrupt them. Guard: the tool reads and writes UTF-8 with `newline=""`, and the fingerprint hashes the UTF-8 bytes, so any mangling shows as a changed item.
- **The real app behaves differently** (for example, a schema step running in a different order). Guard: Task 19 builds the app and runs the full e2e suite.

---

## The gate (run at the end of every task from Task 2 on)

Every task from Task 2 on ends with this exact gate, in PowerShell from the repo root. It is written out here once, and each task's "Run the gate" step runs all of it.

```powershell
$env:CARGO_TARGET_DIR = "$env:TEMP\vs-verify-target"
cargo fmt --all
python tools/split_rust_items.py fingerprint --out "$env:TEMP\l7-split\after.txt" core/src/store.rs (Get-ChildItem core/src/store -Recurse -Filter *.rs).FullName
python tools/split_rust_items.py compare "$env:TEMP\l7-split\baseline.txt" "$env:TEMP\l7-split\after.txt"
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p budget_core --lib 2>&1 | Select-String "^test result"
cargo test --workspace 2>&1 | Select-String "^test result|FAILED|panicked"
```

Expected:
- `compare` prints `identical: 1099 items`.
- `fmt --check` prints nothing.
- clippy finishes with no warnings.
- The lib test line says `741 passed; 0 failed`.
- Every workspace `test result` line says `0 failed`.

**If clippy reports `unused import` in `core/src/store.rs`:** check whether the `lib test` build reports the same name.
- If it does not, the tests still use that name through `use super::*`. Delete it from `store.rs` and add `use <path>;` under `use super::*;` at the top of `core/src/store/tests.rs`.
- Otherwise just delete it from `store.rs`.
Then rerun the gate. (The dry run ended up moving `AccountType`, `RuleSet` and `NaiveDateTime` to `tests.rs` and deleting `Rule`. Which task each one shows up in depends on the order.)

**If the build reports `cannot find macro params`, `cannot find type X` or `no function from_str`** in the new feature file: an import is missing from the list in the task. Add it (`params` → `rusqlite::params`, `from_str` → `std::str::FromStr`, `.year()`/`.month()` private → `chrono::Datelike`, any `store.rs` item → `super::X`), then note the difference in the commit message.

---

### Task 1: The move tool, its tests, and the baseline

**Files:**
- Create: `tools/split_rust_items.py`
- Create: `tools/test_split_rust_items.py`
- Already committed with this plan: `docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json`

**Interfaces:**
- Produces:
  - `python tools/split_rust_items.py move --mapping MAP --step NAME`
  - `fingerprint --out FILE SRC...`
  - `compare BEFORE AFTER` (exit 1 and a list of lost/new items when they differ)
  - Every later task uses these three commands.

- [ ] **Step 1: Write the tests** in `tools/test_split_rust_items.py`:

```python
"""Tests for tools/split_rust_items.py. Run: python -m unittest discover -s tools -p "test_split_rust_items.py" """

import tempfile
import unittest
from pathlib import Path

import split_rust_items as s

STORE = """use crate::models::Transaction;

mod sign_flip;

/// A stored thing.
#[derive(Debug)]
pub struct Thing {
    pub id: i64,
}

impl std::fmt::Display for Thing {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{{thing}}")
    }
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open() -> Self {
        todo!()
    }

    /// Lists things. Braces in a string: "}" and a char: '{'.
    pub fn list_things(&self) -> Vec<Thing> {
        let sql = r#"SELECT "}" FROM t"#;
        vec![]
    }

    fn helper(&self) -> i64 {
        1
    }
}

fn free_helper(a: i64) -> i64 {
    a + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shared() -> i64 {
        2
    }

    #[test]
    fn lists_nothing() {
        assert!(Store::open().list_things().is_empty());
    }
}
"""


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "store").mkdir()
        self.store = self.root / "store.rs"
        self.store.write_text(STORE, encoding="utf-8", newline="")

    def tearDown(self):
        self.tmp.cleanup()

    def fp(self, *paths):
        return s.fingerprint([str(p) for p in paths])[0]


class BraceDelta(Base):
    def test_ignores_braces_in_strings_raw_strings_chars_and_comments(self):
        state = {}
        self.assertEqual(s.brace_delta('let a = "}" ; let b = \'{\'; // }', state), 0)
        self.assertEqual(s.brace_delta('let c = r#"{ "}" "#; {', state), 1)
        self.assertEqual(s.brace_delta("fn f<'a>(x: &'a str) {", state), 1)

    def test_carries_a_multi_line_string(self):
        state = {}
        self.assertEqual(s.brace_delta('let q = "line one {', state), 0)
        self.assertEqual(s.brace_delta('still inside } ";', state), 0)
        self.assertEqual(s.brace_delta("}", state), -1)


class ParseItems(Base):
    def test_finds_top_level_items_methods_and_tests_with_their_doc_comments(self):
        lines = s.read_lines(self.store)
        items = {(it["container"], it["kind"], it["name"]): it for it in s.parse_items(lines)}
        self.assertIn((None, "struct", "Thing"), items)
        self.assertIn((None, "impl", "Thing"), items)
        self.assertIn(("impl Store {", "fn", "list_things"), items)
        self.assertIn(("mod tests {", "fn", "lists_nothing"), items)
        thing = items[(None, "struct", "Thing")]
        self.assertTrue(lines[thing["start"]].startswith("/// A stored thing."))
        list_things = items[("impl Store {", "fn", "list_things")]
        self.assertEqual(lines[list_things["end"] - 1], "    }\n")

    def test_every_non_blank_line_belongs_to_an_item_or_a_container(self):
        lines = s.read_lines(self.store)
        covered = set()
        for it in s.parse_items(lines):
            covered.update(range(it["start"], it["end"]))
        loose = [l.strip() for i, l in enumerate(lines) if l.strip() and i not in covered]
        self.assertEqual(loose, ["impl Store {", "}", "#[cfg(test)]", "mod tests {", "}"])


class Move(Base):
    header = ["//! Things.", "", "use super::Store;", "", "impl Store {", "}"]

    def test_moves_methods_and_types_into_a_new_feature_file_and_registers_it(self):
        before = self.fp(self.store)
        dest = self.root / "store" / "things.rs"
        _, pub_names = s.move(self.store, dest, ["Thing"], "before-impl", "top", self.header)
        s.register(self.store, "things", pub_names)
        s.move(self.store, dest, ["list_things", "helper"], "impl", "impl", self.header)
        text = dest.read_text(encoding="utf-8")
        self.assertIn("pub struct Thing", text)
        self.assertIn("impl std::fmt::Display for Thing", text)
        self.assertLess(text.index("pub struct Thing"), text.index("impl Store {"))
        self.assertIn("    pub fn list_things(&self)", text)
        self.assertTrue(text.rstrip().endswith("}"))
        store = self.store.read_text(encoding="utf-8")
        self.assertNotIn("list_things(&self)", store)
        self.assertIn("mod things;\npub use self::things::{Thing};\n", store)
        self.assertEqual(self.fp(self.store, dest), before)

    def test_moves_the_whole_test_module_out_and_dedents_it(self):
        before = self.fp(self.store)
        tests = self.root / "store" / "tests.rs"
        s.move(self.store, tests, ["*"], "end", "tests", [])
        s.collapse_tests_shell(self.store)
        self.assertIn("#[cfg(test)]\nmod tests;\n", self.store.read_text(encoding="utf-8"))
        text = tests.read_text(encoding="utf-8")
        self.assertIn("\nuse super::*;\n", text)
        self.assertIn("\n#[test]\nfn lists_nothing() {\n    assert!", text)
        self.assertEqual(self.fp(self.store, tests), before)

    def test_refuses_a_name_that_is_not_there_and_changes_nothing(self):
        with self.assertRaises(SystemExit):
            s.move(self.store, self.root / "store" / "x.rs", ["no_such_fn"], "impl", "impl", self.header)
        self.assertEqual(self.store.read_text(encoding="utf-8"), STORE)
        self.assertFalse((self.root / "store" / "x.rs").exists())


class Fingerprint(Base):
    def test_ignores_reflow_trailing_commas_visibility_and_imports(self):
        before = self.fp(self.store)
        text = STORE.replace("    fn helper(&self) -> i64 {", "    pub(super) fn helper(\n        &self,\n    ) -> i64 {")
        text = text.replace("use crate::models::Transaction;", "use crate::models::{Account, Transaction};")
        self.store.write_text(text, encoding="utf-8", newline="")
        self.assertEqual(self.fp(self.store), before)

    def test_notices_a_changed_literal_and_a_dropped_item(self):
        before = self.fp(self.store)
        self.store.write_text(STORE.replace("a + 1", "a + 2"), encoding="utf-8", newline="")
        self.assertNotEqual(self.fp(self.store), before)
        self.store.write_text(STORE.replace("    fn helper(&self) -> i64 {\n        1\n    }\n", ""), encoding="utf-8", newline="")
        self.assertNotEqual(self.fp(self.store), before)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them and watch them fail**

Run: `python -m unittest discover -s tools -p "test_split_rust_items.py"`
Expected: `ModuleNotFoundError: No module named 'split_rust_items'`

- [ ] **Step 3: Write the tool** in `tools/split_rust_items.py`:

```python
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
DECL_RE = re.compile(r"^\s*(pub(\([^)]*\))?\s+)?(use|mod)\s")
TOP_DECL_RE = re.compile(r"^(pub(\([^)]*\))?\s+)?(use|mod)\s")
CHAR_RE = re.compile(r"'(\\(u\{[0-9a-fA-F]+\}|x[0-9a-fA-F]{2}|.)|[^\\'])'")
RAW_START_RE = re.compile(r'b?r(#*)"')


def brace_delta(line, state):
    """Net `{` minus `}` on `line`, skipping strings, raw strings, char literals and comments.
    `state` carries an open block comment or string from one line to the next and is updated in place."""
    delta, i, n = 0, 0, len(line)
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
        elif c == "}":
            delta -= 1
        i += 1
    return delta


def is_trivia(stripped):
    return stripped.startswith("//") or stripped.startswith("#[") or stripped.startswith("#![")


def first_code_line(text_lines):
    return next((l for l in text_lines if l.strip() and not is_trivia(l.strip())), "")


def item_name(text_lines):
    line = first_code_line(text_lines)
    if not line:
        return "comment", text_lines[0].strip()[:40] if text_lines else ""
    for rx, kind in NAME_RES:
        m = rx.search(line)
        if m:
            return kind, m.groups()[-1].split("::")[-1]
    return "other", line.strip()[:40]


def strip_line_comment(line):
    return re.sub(r"\s*//[^\"]*$", "", line.rstrip())


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
                opened = opened or depth > 0 or "{" in lines[k]
                code = strip_line_comment(lines[k])
                if depth == 0 and ((opened and code.endswith(("}", "};", "},"))) or (not opened and code.endswith(";"))):
                    break
                k += 1
            kind, name = item_name(lines[i : k + 1])
            items.append(dict(start=i, end=k + 1, kind=kind, name=name, container=container))
            i = k + 1

    walk(0, len(lines), None)
    return items


def read_lines(path):
    return Path(path).read_text(encoding="utf-8").splitlines(keepends=True)


def newline_of(lines):
    return "\r\n" if lines and lines[0].endswith("\r\n") else "\n"


def normalize(text):
    """What a pure move may not change: everything except whitespace, commas (rustfmt adds and drops
    trailing ones when it reflows) and pub(super)/pub(crate) (a moved item may need wider visibility)."""
    text = re.sub(r"pub\((super|crate)\)", "", text)
    return re.sub(r"[\s,]", "", text)


def fingerprint(paths):
    """(Counter of item hashes, {hash: label}) over `paths`, leaving out use/mod declarations and //! docs."""
    counts, labels = Counter(), {}
    for p in paths:
        lines = read_lines(p)
        for it in parse_items(lines):
            text = lines[it["start"] : it["end"]]
            body = "".join(text)
            if DECL_RE.match(first_code_line(text)) or body.lstrip().startswith("//!"):
                continue
            h = hashlib.sha1(normalize(body).encode("utf-8")).hexdigest()[:12]
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


def reindent(text_lines, remove, add):
    out = []
    for l in text_lines:
        if not l.strip():
            out.append(l.lstrip(" "))
            continue
        if remove and l.startswith(" " * remove):
            l = l[remove:]
        out.append(" " * add + l if add else l)
    return out


def move(src, dest, names, where, container_kind, header=None):
    """Cut the named items out of `src` and add them to `dest`, in source order.
    where: "end" (append), "impl" (before the closing `}` of dest's last container) or
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
        idx = max(i for i, l in enumerate(dest_lines) if l.rstrip() == "}")
        dest_lines[idx:idx] = block
    Path(src).write_text("".join(l for i, l in enumerate(src_lines) if i not in drop), encoding="utf-8", newline="")
    dest_path.write_text("".join(dest_lines), encoding="utf-8", newline="")
    pub_names = [
        it["name"]
        for it in found
        if it["container"] is None
        and it["kind"] in ("struct", "enum", "const", "type", "fn")
        and first_code_line(src_lines[it["start"] : it["end"]]).startswith("pub ")
    ]
    return [it["name"] for it in found], pub_names


def register(parent, stem, pub_names):
    """Declare `mod stem;` in `parent` after its last top-level use/mod line (once), and re-export `pub_names`."""
    lines = read_lines(parent)
    nl = newline_of(lines)
    decl = f"mod {stem};{nl}"
    if decl not in lines:
        last = max(i for i, l in enumerate(lines) if TOP_DECL_RE.match(l))
        lines.insert(last + 1, decl)
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
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `python -m unittest discover -s tools -p "test_split_rust_items.py"`
Expected: `Ran 9 tests ... OK`

- [ ] **Step 5: Check that the parser covers the real file**

```powershell
python -c "import sys; sys.path.insert(0,'tools'); import split_rust_items as s; L=s.read_lines('core/src/store.rs'); c=set(); [c.update(range(i['start'],i['end'])) for i in s.parse_items(L)]; print([l.strip() for i,l in enumerate(L) if l.strip() and i not in c])"
```
Expected: `['impl Store {', '}', '#[cfg(test)]', 'mod tests {', '}']` (only the two container wrappers).

- [ ] **Step 6: Record the baseline**

```powershell
New-Item -ItemType Directory -Force "$env:TEMP\l7-split" | Out-Null
python tools/split_rust_items.py fingerprint --out "$env:TEMP\l7-split\baseline.txt" core/src/store.rs (Get-ChildItem core/src/store -Recurse -Filter *.rs).FullName
$env:CARGO_TARGET_DIR = "$env:TEMP\vs-verify-target"
cargo test -p budget_core --lib 2>&1 | Select-String "^test result"
```
Expected: `1099 items -> ...baseline.txt` and `test result: ok. 741 passed; 0 failed`. If the count is not 741, stop and report: `store.rs` has changed since this plan was written, and the mapping must be rebuilt before any move.
If `%TEMP%\l7-split\baseline.txt` is ever lost, recreate it from commit `6d2e981`: `git worktree add $env:TEMP\l7-base 6d2e981`, run the same fingerprint command there, then `git worktree remove $env:TEMP\l7-base`.

- [ ] **Step 7: Commit**

```bash
git add tools/split_rust_items.py tools/test_split_rust_items.py
git commit -m "Tool to move Rust items between files and fingerprint them (L7 store split)"
```

---

### Task 2: Move the inline tests to `store/tests.rs`

**Files:**
- Create: `core/src/store/tests.rs` (≈11,750 lines, shrinks as later tasks move tests out)
- Modify: `core/src/store.rs` (`#[cfg(test)] mod tests { … }` becomes `#[cfg(test)] mod tests;`)

**Interfaces:**
- Produces: `store::tests`, starting `use super::*;`. Later tasks add `mod <feature>;` to it and move tests into `core/src/store/tests/<feature>.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step tests-out`
Expected: `core/src/store.rs -> core/src/store/tests.rs: <n> items` and `mod tests { … } is now mod tests;`

- [ ] **Step 2: Look at the seam**

Run: `git diff core/src/store.rs | Select-Object -Last 15` and `Get-Content core/src/store/tests.rs -TotalCount 12`
Expected: `store.rs` ends with `#[cfg(test)]` / `mod tests;`, and `tests.rs` starts with `use super::*;`, `use crate::models::Transaction;`, `use chrono::NaiveDate;` at column 0.

- [ ] **Step 3: Run the gate** (above). `store.rs` is now about 9,360 lines.

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/tests.rs
git commit -m "store.rs: move the inline tests to store/tests.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 3: Schema and migrations → `store/schema.rs`

**Files:**
- Create: `core/src/store/schema.rs`
- Create: `core/src/store/tests/schema.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod schema;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod schema;` added by the tool)

**Interfaces:**
- Moves 44 `impl Store` methods, 1 top-level types/helpers, 2 tests and test helpers (exact names: the `"schema"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- Produces: `pub(super) fn init_schema` (the other modules and tests rely on reaching it).

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step schema`
Expected: one line per group (1, 44, 2 items), each followed by a `mod schema;` registration line.

- [ ] **Step 2: Imports for `core/src/store/schema.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::Store;
use crate::models::AccountType;
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Import for `core/src/store/tests/schema.rs`**

Under its `use super::*;` line add:

```rust
use crate::store::schema::DEFAULT_CATEGORIES;
```

- [ ] **Step 4: Widen what other modules reach to `pub(super)`**

- `core/src/store/schema.rs`: `    fn init_schema(` → `    pub(super) fn init_schema(` (`Store::open*` in store.rs, `encryption.rs` and three tests call it).
- `core/src/store/schema.rs`: `    fn migrate_fix_stale_manual_balance_override_reset_dates(` → `    pub(super) fn migrate_fix_stale_manual_balance_override_reset_dates(` (an accounts test calls it).
- `core/src/store/schema.rs`: `    fn migrate_flip_loan_transaction_signs_if_needed(` → `    pub(super) fn migrate_flip_loan_transaction_signs_if_needed(` (two schema tests call it).
- `core/src/store/schema.rs`: `const DEFAULT_CATEGORIES` → `pub(super) const DEFAULT_CATEGORIES` (a schema test reads it).

Nothing else changes visibility. If the compiler names another private item, it means the mapping has drifted: stop and report.

- [ ] **Step 5: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 6: Commit**

```bash
git add core/src/store.rs core/src/store/schema.rs core/src/store/tests.rs core/src/store/tests/schema.rs
git commit -m "store.rs: move schema into store/schema.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 4: Accounts → `store/accounts.rs`

**Files:**
- Create: `core/src/store/accounts.rs`
- Create: `core/src/store/tests/accounts.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod accounts;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod accounts;` added by the tool)

**Interfaces:**
- Moves 26 `impl Store` methods, 3 top-level types/helpers, 90 tests and test helpers (exact names: the `"accounts"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- Produces: `pub(super) fn account_balance_as_of`, `pub(super) fn holdings_value_by_account` (forecast, investments and reports use them).

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step accounts`
Expected: one line per group (3, 26, 90 items), each followed by a `mod accounts;` registration line.

- [ ] **Step 2: Imports for `core/src/store/accounts.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{Store, StoredAccount, month_bounds};
use crate::models::{Account, AccountType};
use chrono::{Datelike, NaiveDate, NaiveDateTime};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Widen what other modules reach to `pub(super)`**

- `core/src/store/accounts.rs`: `    fn account_balance_as_of(` → `    pub(super) fn account_balance_as_of(` (store.rs, forecasts, reports and two accounts tests call it).
- `core/src/store/accounts.rs`: `    fn holdings_value_by_account(` → `    pub(super) fn holdings_value_by_account(` (investments and reports call it).

Nothing else changes visibility. If the compiler names another private item, it means the mapping has drifted: stop and report.

- [ ] **Step 4: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 5: Commit**

```bash
git add core/src/store.rs core/src/store/accounts.rs core/src/store/tests.rs core/src/store/tests/accounts.rs
git commit -m "store.rs: move accounts into store/accounts.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 5: Family members → `store/family.rs`

**Files:**
- Create: `core/src/store/family.rs`
- Create: `core/src/store/tests/family.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod family;`)
- Modify: `core/src/store/tests.rs` (tests removed; `mod family;` added by the tool)

**Interfaces:**
- Moves 4 `impl Store` methods, 5 tests and test helpers (exact names: the `"family"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step family`
Expected: one line per group (4, 5 items), each followed by a `mod family;` registration line.

- [ ] **Step 2: Imports for `core/src/store/family.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{FamilyMember, Store};
use rusqlite::params;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/family.rs core/src/store/tests.rs core/src/store/tests/family.rs
git commit -m "store.rs: move family into store/family.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 6: Rules → `store/rules.rs`

**Files:**
- Create: `core/src/store/rules.rs`
- Create: `core/src/store/tests/rules.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod rules;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod rules;` added by the tool)

**Interfaces:**
- Moves 11 `impl Store` methods, 2 top-level types/helpers, 18 tests and test helpers (exact names: the `"rules"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step rules`
Expected: one line per group (2, 11, 18 items), each followed by a `mod rules;` registration line.

- [ ] **Step 2: Imports for `core/src/store/rules.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{CategorySource, Store};
use crate::rules::{Rule, RuleSet};
use rusqlite::params;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/rules.rs core/src/store/tests.rs core/src/store/tests/rules.rs
git commit -m "store.rs: move rules into store/rules.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 7: Transfers → `store/transfers.rs`

**Files:**
- Create: `core/src/store/transfers.rs`
- Create: `core/src/store/tests/transfers.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod transfers;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod transfers;` added by the tool)

**Interfaces:**
- Moves 13 `impl Store` methods, 1 top-level types/helpers, 28 tests and test helpers (exact names: the `"transfers"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step transfers`
Expected: one line per group (1, 13, 28 items), each followed by a `mod transfers;` registration line.

- [ ] **Step 2: Imports for `core/src/store/transfers.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::Store;
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/transfers.rs core/src/store/tests.rs core/src/store/tests/transfers.rs
git commit -m "store.rs: move transfers into store/transfers.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 8: Categories → `store/categories.rs`

**Files:**
- Create: `core/src/store/categories.rs`
- Create: `core/src/store/tests/categories.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod categories;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod categories;` added by the tool)

**Interfaces:**
- Moves 12 `impl Store` methods, 5 top-level types/helpers, 25 tests and test helpers (exact names: the `"categories"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step categories`
Expected: one line per group (5, 12, 25 items), each followed by a `mod categories;` registration line.

- [ ] **Step 2: Imports for `core/src/store/categories.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{CategorySource, Store};
use crate::models::Transaction;
use rusqlite::params;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/categories.rs core/src/store/tests.rs core/src/store/tests/categories.rs
git commit -m "store.rs: move categories into store/categories.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 9: Transactions → `store/transactions.rs`

**Files:**
- Create: `core/src/store/transactions.rs`
- Create: `core/src/store/tests/transactions.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod transactions;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod transactions;` added by the tool)

**Interfaces:**
- Moves 28 `impl Store` methods, 7 top-level types/helpers, 87 tests and test helpers (exact names: the `"transactions"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step transactions`
Expected: one line per group (7, 28, 87 items), each followed by a `mod transactions;` registration line.

- [ ] **Step 2: Imports for `core/src/store/transactions.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{CategorySource, Store, fingerprint};
use crate::models::Transaction;
use chrono::{NaiveDate, NaiveDateTime};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Widen what other modules reach to `pub(super)`**

- `core/src/store/transactions.rs`: `    fn hard_delete_transaction_row(` → `    pub(super) fn hard_delete_transaction_row(` (`delete_account` in accounts.rs calls it).

Nothing else changes visibility. If the compiler names another private item, it means the mapping has drifted: stop and report.

- [ ] **Step 4: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 5: Commit**

```bash
git add core/src/store.rs core/src/store/transactions.rs core/src/store/tests.rs core/src/store/tests/transactions.rs
git commit -m "store.rs: move transactions into store/transactions.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 10: Buckets → `store/buckets.rs`

**Files:**
- Create: `core/src/store/buckets.rs`
- Create: `core/src/store/tests/buckets.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod buckets;`)
- Modify: `core/src/store/tests.rs` (tests removed; `mod buckets;` added by the tool)

**Interfaces:**
- Moves 9 `impl Store` methods, 29 tests and test helpers (exact names: the `"buckets"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step buckets`
Expected: one line per group (9, 29 items), each followed by a `mod buckets;` registration line.

- [ ] **Step 2: Imports for `core/src/store/buckets.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{Store, StoredBucket};
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/buckets.rs core/src/store/tests.rs core/src/store/tests/buckets.rs
git commit -m "store.rs: move buckets into store/buckets.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 11: Budgets → `store/budgets.rs`

**Files:**
- Create: `core/src/store/budgets.rs`
- Create: `core/src/store/tests/budgets.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod budgets;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod budgets;` added by the tool)

**Interfaces:**
- Moves 19 `impl Store` methods, 10 top-level types/helpers, 84 tests and test helpers (exact names: the `"budgets"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step budgets`
Expected: one line per group (10, 19, 84 items), each followed by a `mod budgets;` registration line.

- [ ] **Step 2: Imports for `core/src/store/budgets.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store, month_bounds};
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Import for `core/src/store/tests/budgets.rs`**

Under its `use super::*;` line add:

```rust
use crate::store::budgets::month_key_back;
```

- [ ] **Step 4: Widen what other modules reach to `pub(super)`**

- `core/src/store/budgets.rs`: `    fn month_key_back(` → `    pub(super) fn month_key_back(` (a budgets test calls it).

Nothing else changes visibility. If the compiler names another private item, it means the mapping has drifted: stop and report.

- [ ] **Step 5: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 6: Commit**

```bash
git add core/src/store.rs core/src/store/budgets.rs core/src/store/tests.rs core/src/store/tests/budgets.rs
git commit -m "store.rs: move budgets into store/budgets.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 12: Insights → `store/insights.rs`

**Files:**
- Create: `core/src/store/insights.rs`
- Create: `core/src/store/tests/insights.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod insights;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod insights;` added by the tool)

**Interfaces:**
- Moves 7 `impl Store` methods, 4 top-level types/helpers, 27 tests and test helpers (exact names: the `"insights"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step insights`
Expected: one line per group (4, 7, 27 items), each followed by a `mod insights;` registration line.

- [ ] **Step 2: Imports for `core/src/store/insights.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store, month_bounds, normalize_description};
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/insights.rs core/src/store/tests.rs core/src/store/tests/insights.rs
git commit -m "store.rs: move insights into store/insights.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 13: Recurring → `store/recurring.rs`

**Files:**
- Create: `core/src/store/recurring.rs`
- Create: `core/src/store/tests/recurring.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod recurring;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod recurring;` added by the tool)

**Interfaces:**
- Moves 11 `impl Store` methods, 12 top-level types/helpers, 53 tests and test helpers (exact names: the `"recurring"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step recurring`
Expected: one line per group (12, 11, 53 items), each followed by a `mod recurring;` registration line.

- [ ] **Step 2: Imports for `core/src/store/recurring.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store, StoredRecurring, add_one_month, add_one_year, next_occurrence, normalize_description};
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/recurring.rs core/src/store/tests.rs core/src/store/tests/recurring.rs
git commit -m "store.rs: move recurring into store/recurring.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 14: Investments → `store/investments.rs`

**Files:**
- Create: `core/src/store/investments.rs`
- Create: `core/src/store/tests/investments.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod investments;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod investments;` added by the tool)

**Interfaces:**
- Moves 19 `impl Store` methods, 7 top-level types/helpers, 47 tests and test helpers (exact names: the `"investments"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step investments`
Expected: one line per group (7, 19, 47 items), each followed by a `mod investments;` registration line.

- [ ] **Step 2: Imports for `core/src/store/investments.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{Store, first_of_month};
use crate::models::AccountType;
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/investments.rs core/src/store/tests.rs core/src/store/tests/investments.rs
git commit -m "store.rs: move investments into store/investments.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 15: Settings → `store/settings.rs`

**Files:**
- Create: `core/src/store/settings.rs`
- Create: `core/src/store/tests/settings.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod settings;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod settings;` added by the tool)

**Interfaces:**
- Moves 20 `impl Store` methods, 4 top-level types/helpers, 25 tests and test helpers (exact names: the `"settings"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step settings`
Expected: one line per group (4, 20, 25 items), each followed by a `mod settings;` registration line.

- [ ] **Step 2: Imports for `core/src/store/settings.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{Store, StoredAppSettings};
use chrono::{NaiveDate, NaiveDateTime};
use rusqlite::params;
use rust_decimal::Decimal;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/settings.rs core/src/store/tests.rs core/src/store/tests/settings.rs
git commit -m "store.rs: move settings into store/settings.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 16: Assets → `store/assets.rs`

**Files:**
- Create: `core/src/store/assets.rs`
- Create: `core/src/store/tests/assets.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod assets;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod assets;` added by the tool)

**Interfaces:**
- Moves 6 `impl Store` methods, 1 top-level types/helpers, 9 tests and test helpers (exact names: the `"assets"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step assets`
Expected: one line per group (1, 6, 9 items), each followed by a `mod assets;` registration line.

- [ ] **Step 2: Imports for `core/src/store/assets.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::Store;
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/assets.rs core/src/store/tests.rs core/src/store/tests/assets.rs
git commit -m "store.rs: move assets into store/assets.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 17: Forecasts → `store/forecast.rs`

**Files:**
- Create: `core/src/store/forecast.rs`
- Create: `core/src/store/tests/forecast.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod forecast;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod forecast;` added by the tool)

**Interfaces:**
- Moves 5 `impl Store` methods, 6 top-level types/helpers, 17 tests and test helpers (exact names: the `"forecast"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step forecast`
Expected: one line per group (6, 5, 17 items), each followed by a `mod forecast;` registration line.

- [ ] **Step 2: Imports for `core/src/store/forecast.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store, StoredAccount, StoredRecurring, add_one_month, next_occurrence, normalize_description};
use crate::models::AccountType;
use chrono::NaiveDate;
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/forecast.rs core/src/store/tests.rs core/src/store/tests/forecast.rs
git commit -m "store.rs: move forecast into store/forecast.rs (pure move; fingerprint identical, 741 tests)"
```

---

### Task 18: Reports → `store/reports.rs`

**Files:**
- Create: `core/src/store/reports.rs`
- Create: `core/src/store/tests/reports.rs`
- Modify: `core/src/store.rs` (items removed; the tool adds `mod reports;` and a `pub use` for each moved `pub` type)
- Modify: `core/src/store/tests.rs` (tests removed; `mod reports;` added by the tool)

**Interfaces:**
- Moves 10 `impl Store` methods, 5 top-level types/helpers, 27 tests and test helpers (exact names: the `"reports"` entry of the mapping).
- Public API unchanged: the tool re-exports every moved `pub` type from `store.rs`.

- [ ] **Step 1: Move**

Run: `python tools/split_rust_items.py move --mapping docs/superpowers/plans/2026-10-02-split-store-rs-mapping.json --step reports`
Expected: one line per group (5, 10, 27 items), each followed by a `mod reports;` registration line.

- [ ] **Step 2: Imports for `core/src/store/reports.rs`**

Replace the single `use super::Store;` line the tool wrote at the top with:

```rust
use super::{LIVE_TRANSFER_LEG_IDS_SQL, Store, month_bounds};
use crate::models::AccountType;
use chrono::{Datelike, NaiveDate};
use rusqlite::params;
use rust_decimal::Decimal;
use std::str::FromStr;
```

- [ ] **Step 3: Run the gate** (see "The gate" above, including its unused-import rule).

- [ ] **Step 4: Commit**

```bash
git add core/src/store.rs core/src/store/reports.rs core/src/store/tests.rs core/src/store/tests/reports.rs
git commit -m "store.rs: move reports into store/reports.rs (pure move; fingerprint identical, 741 tests)"
```

---


### Task 19: Final checks, the running app, and the record

**Files:**
- Modify: `E:\misc\Programming\Claude\vault-spend-context.md` (L7 status and the new layout)

- [ ] **Step 1: Check the targets from the spec**

```powershell
Get-ChildItem core/src/store.rs, core/src/store/*.rs, core/src/store/tests.rs, core/src/store/tests/*.rs | ForEach-Object { "{0,6} {1}" -f (Get-Content $_).Count, $_.Name } | Sort-Object
```
Expected:
- `store.rs` about 540 lines (target under 1,500).
- Largest production file `schema.rs` about 1,540.
- Largest test file `tests/transactions.rs` about 1,850.
- Nothing over about 2,000.

- [ ] **Step 2: Check every public name is still exported**

```powershell
$names = git show 6d2e981:core/src/store.rs | Select-String '^pub (struct|enum|const|fn|type|static) (\w+)' | ForEach-Object { $_.Matches[0].Groups[2].Value } | Sort-Object -Unique
$flat = (Get-Content core/src/store.rs -Raw) -replace '\s+', ' '
$names | Where-Object { $flat -notmatch "pub (struct|enum|const|fn|type|static) $_\b" -and $flat -notmatch "pub use self::\w+::(\{[^}]*\b$_\b[^}]*\}|$_;)" }
```
Expected: no output (60 names checked).

- [ ] **Step 3: Full gate once more, plus the frontend checks** (nothing in `src/` changed; this confirms it)

Run the gate, then `npm test` and `npx tsc --noEmit`.
Expected: as in the gate; vitest all passed; tsc clean.

- [ ] **Step 4: Build the app and run the full e2e suite**

```powershell
$env:CARGO_TARGET_DIR = "$env:TEMP\vs-verify-target"
npx tauri build --debug --no-bundle   # retry once if it fails with "failed to build app"; look for "Built application at:"
$env:VAULTSPEND_EXE = "$env:TEMP\vs-verify-target\debug\vaultspend.exe"
node e2e/run-all.mjs *> "$env:TEMP\l7-split\full-e2e.log"
Select-String -Path "$env:TEMP\l7-split\full-e2e.log" -Pattern "passed|failed" | Select-Object -Last 5
```
Expected: all specs pass (161 at `ff0cfea`). A failure in one of the known flaky specs (7, 24, 28, 112, 122, 132, 153) gets rerun alone with `node e2e/run-all.mjs --spec=<n>` and reported as such. Any other failure is a real regression, so stop and investigate.

- [ ] **Step 5: Update the session context file**

In `E:\misc\Programming\Claude\vault-spend-context.md`:
- Mark L7 part 1 done, with the commit range.
- Replace "holds business logic as methods on one `Store` struct in `core/src/store.rs` (~19,500 lines, not split by feature — look there first)" with: "methods on one `Store` struct, split by feature into `core/src/store/<feature>.rs` (accounts, transactions, budgets, …; `store.rs` keeps `Store`, `open`, shared types and helpers), tests in `core/src/store/tests/<feature>.rs`; `tools/split_rust_items.py` moves items and fingerprints them."
- List what is left of L7 (`commands.rs`, `App.tsx`, `App.css`).

- [ ] **Step 6: Commit** (only if a repo file changed in this task; the context file lives outside the repo)

---

## Notes for the executor

- **Do not regenerate the mapping** unless Task 1 Step 6 shows a test count other than 741 (meaning `store.rs` changed after this plan). The mapping was built from `core/src/store.rs` at `ff0cfea`/`6d2e981`:
  - methods are grouped by the block they sit in;
  - types and free helpers go to the one feature that uses them, or stay in `store.rs`;
  - tests go to the feature whose methods they (or their helpers) call most, and the rest stay in `store/tests.rs`.
- **If a move fails with `not found: …`**, a name in the mapping no longer exists. Stop and report; don't edit the mapping by hand.
- **A test lands in the "wrong" feature file?** Leave it. The mapping is a heuristic, a test's file doesn't change what it checks, and moving it again later is cheap with the tool.
- **Stray running `vaultspend.exe`** (from the owner) can lock files. That's why the verify target dir is used. Never kill the owner's processes; check with `Get-Process -Name vaultspend` and ask.
