import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const networkNames = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "sendBeacon"]);
const browserGlobals = new Set(["window", "self", "globalThis", "navigator"]);

/** Conservative source guard, complementary to CSP. Not an arbitrary-JS sandbox.
 * Reject acquiring a network capability, so aliases cannot avoid a call-name regex.
 * Comments, strings and type-only references are not executable acquisitions. */
export function networkCapabilities(source: string, file = "fixture.ts"): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = new Set<string>();
  const globals = new Set(browserGlobals);
  // Track browser-object aliases as well as references to the capability itself.
  let changed = true;
  while (changed) {
    changed = false;
    function aliases(node: ts.Node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(node.initializer) && globals.has(node.initializer.text) && !globals.has(node.name.text)) {
        globals.add(node.name.text); changed = true;
      }
      ts.forEachChild(node, aliases);
    }
    aliases(ast);
  }
  function visit(node: ts.Node) {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    if (ts.isIdentifier(node) && networkNames.has(node.text)) found.add(node.text);
    if (ts.isElementAccessExpression(node)) {
      const key = node.argumentExpression;
      if (ts.isStringLiteralLike(key) && networkNames.has(key.text)) found.add(key.text);
      else if (ts.isIdentifier(node.expression) && globals.has(node.expression.text) && !ts.isStringLiteralLike(key)) found.add("computed browser capability");
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(ast) === "Reflect" && node.expression.name.text === "get" && node.arguments[0] && ts.isIdentifier(node.arguments[0]) && globals.has(node.arguments[0].text)) found.add("reflected browser capability");
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return [...found].sort();
}

/** Follow local runtime imports, re-exports and literal lazy imports from the
 * desktop entry. External packages are governed separately by CSP/audit policy. */
export function rendererSourceGraph(entry: string): Map<string, string> {
  const sources = new Map<string, string>();
  function visit(file: string) {
    if (sources.has(file)) return;
    const source = readFileSync(file, "utf8");
    sources.set(file, source);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function dependency(specifier: string) {
      if (!specifier.startsWith(".")) return;
      if (specifier.endsWith("?raw") || specifier.endsWith("?url")) return;
      if (/\.(css|png|jpe?g|webp|ico|svg|woff2?|json)$/.test(specifier)) return;
      const base = path.resolve(path.dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(p => existsSync(p) && /\.[cm]?[jt]sx?$/.test(p));
      if (!target) throw new Error(`Unresolved renderer dependency: ${file}: ${specifier}`);
      visit(target);
    }
    function walk(node: ts.Node) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        if (!clause || clause.name || (bindings && (ts.isNamespaceImport(bindings) || bindings.elements.some(e => !e.isTypeOnly)))) dependency(node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const clause = node.exportClause;
        if (!clause || ts.isNamespaceExport(clause) || clause.elements.some(e => !e.isTypeOnly)) dependency(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) throw new Error(`Nonliteral renderer import: ${file}`);
        dependency(node.arguments[0].text);
      }
      ts.forEachChild(node, walk);
    }
    walk(ast);
  }
  visit(path.resolve(entry));
  return sources;
}
