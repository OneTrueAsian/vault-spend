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


class EdgeCases(Base):
    def test_a_raw_c_string_is_one_literal(self):
        self.assertEqual(s.brace_delta('let c = cr#"{ " }"#; {', {}), 1)
        self.assertIn('cr#"{ " }"#', s.tokenize('let c = cr#"{ " }"#;'))

    def test_a_brace_inside_a_string_does_not_end_an_item_early(self):
        lines = ['const T: [&str; 1] = [\n', '    "{a}",\n', '];\n', '\n', 'fn after() {}\n']
        names = [it["name"] for it in s.parse_items(lines)]
        self.assertEqual(names, ["T", "after"])

    def test_a_multi_line_attribute_does_not_become_the_name(self):
        lines = ["#[derive(\n", "    Debug,\n", "    Clone,\n", ")]\n", "pub struct Wide {\n", "    a: i64,\n", "}\n"]
        self.assertEqual([(it["kind"], it["name"]) for it in s.parse_items(lines)], [("struct", "Wide")])

    def test_moving_into_an_impl_followed_by_a_free_fn_lands_inside_the_impl(self):
        dest = self.root / "store" / "things.rs"
        dest.write_text("impl Store {\n}\n\nfn trailing() -> i64 {\n    0\n}\n", encoding="utf-8", newline="")
        s.move(self.store, dest, ["helper"], "impl", "impl")
        self.assertEqual(
            dest.read_text(encoding="utf-8"),
            "impl Store {\n\n    fn helper(&self) -> i64 {\n        1\n    }\n}\n\nfn trailing() -> i64 {\n    0\n}\n",
        )

    def test_crlf_files_stay_crlf(self):
        self.store.write_text(STORE.replace("\n", "\r\n"), encoding="utf-8", newline="")
        dest = self.root / "store" / "things.rs"
        s.move(self.store, dest, ["helper"], "impl", "impl", ["impl Store {", "}"])
        for p in (self.store, dest):
            raw = p.read_bytes()
            self.assertNotIn(b"\n", raw.replace(b"\r\n", b""), f"{p.name} has a bare LF")


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

    def test_registers_after_the_leading_declarations_not_at_the_bottom_or_inside_a_wrapped_use(self):
        text = STORE.replace(
            "mod sign_flip;\n",
            "mod sign_flip;\npub use self::sign_flip::{\n    FlipSignsError,\n    FlipSignsSummary,\n};\n",
        ).replace("mod tests {", "mod tests_inline {")
        text += "\n#[cfg(test)]\nmod tests;\n"
        self.store.write_text(text, encoding="utf-8", newline="")
        s.register(self.store, "things", ["Thing"])
        out = self.store.read_text(encoding="utf-8")
        self.assertIn("    FlipSignsSummary,\n};\nmod things;\npub use self::things::{Thing};\n", out)
        self.assertTrue(out.endswith("#[cfg(test)]\nmod tests;\n"))

    def test_moving_out_of_a_container_keeps_multi_line_literals_verbatim(self):
        text = STORE.replace(
            "    #[test]\n    fn lists_nothing() {\n",
            '    #[test]\n    fn lists_nothing() {\n        let sql = "SELECT a\n            FROM t";\n        let raw = r#"x\n    y"#;\n',
        )
        self.store.write_text(text, encoding="utf-8", newline="")
        tests = self.root / "store" / "tests.rs"
        s.move(self.store, tests, ["*"], "end", "tests", [])
        out = tests.read_text(encoding="utf-8")
        self.assertIn('    let sql = "SELECT a\n            FROM t";\n', out)
        self.assertIn('    let raw = r#"x\n    y"#;\n', out)

    def test_a_destination_that_cannot_be_written_leaves_the_source_untouched(self):
        import os
        import stat

        dest = self.root / "store" / "things.rs"
        dest.write_text("impl Store {\n}\n", encoding="utf-8", newline="")
        os.chmod(dest, stat.S_IREAD)
        try:
            with self.assertRaises(OSError):
                s.move(self.store, dest, ["helper"], "impl", "impl")
        finally:
            os.chmod(dest, stat.S_IREAD | stat.S_IWRITE)
        self.assertEqual(self.store.read_text(encoding="utf-8"), STORE)

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

    def assert_detected(self, before_text, after_text):
        self.store.write_text(before_text, encoding="utf-8", newline="")
        before = self.fp(self.store)
        self.store.write_text(after_text, encoding="utf-8", newline="")
        self.assertNotEqual(self.fp(self.store), before, "the fingerprint missed a real edit")

    def test_notices_edits_inside_string_literals(self):
        sql = STORE.replace('r#"SELECT "}" FROM t"#', 'r#"SELECT a, b FROM t WHERE x"#')
        self.assert_detected(sql, sql.replace("SELECT a, b", "SELECT a b"))
        self.assert_detected(sql, sql.replace("FROM t WHERE", "FROM tWHERE"))

    def test_notices_a_dropped_comma_between_arguments_and_a_new_pub_crate(self):
        args = STORE.replace("a + 1", "g(a, 1)")
        self.assert_detected(args, args.replace("g(a, 1)", "g(a1)"))
        self.assert_detected(STORE, STORE.replace("fn free_helper(", "pub(crate) fn free_helper("))

    def test_notices_a_method_moved_out_of_its_impl(self):
        moved = STORE.replace("    fn helper(&self) -> i64 {\n        1\n    }\n}\n", "}\n\nfn helper(&self) -> i64 {\n    1\n}\n")
        self.assert_detected(STORE, moved)

    def test_does_not_skip_code_that_only_starts_like_a_declaration(self):
        quoted = STORE.replace("mod sign_flip;\n", 'mod sign_flip; // see "x"\nfn quoted() -> i64 {\n    3\n}\n')
        self.assert_detected(quoted, quoted.replace("    3\n", "    4\n"))
        inner_doc = STORE.replace("fn free_helper(", "//! Module notes.\nfn free_helper(")
        self.assert_detected(inner_doc, inner_doc.replace("a + 1", "a + 2"))
        inline = STORE + "\nmod inline {\n    fn f() -> i64 {\n        5\n    }\n}\n"
        self.assert_detected(inline, inline.replace("        5\n", "        6\n"))

    def test_notices_a_changed_literal_and_a_dropped_item(self):
        before = self.fp(self.store)
        self.store.write_text(STORE.replace("a + 1", "a + 2"), encoding="utf-8", newline="")
        self.assertNotEqual(self.fp(self.store), before)
        self.store.write_text(STORE.replace("    fn helper(&self) -> i64 {\n        1\n    }\n", ""), encoding="utf-8", newline="")
        self.assertNotEqual(self.fp(self.store), before)


if __name__ == "__main__":
    unittest.main()
