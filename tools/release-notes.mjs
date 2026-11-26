// Builds the GitHub release page body for a version from its entry in src/shared/lib/changelog.ts, the same entry the app's What's New shows (VS-135).
// The body is each group in the order written (New features, Enhancements, Bug fixes), then the install notes. A version with no notes is refused.
// Usage: node tools/release-notes.mjs <version> [--check] [--github-output <name>]
//   (no flag)              print the body
//   --check                only check the notes exist and say how many there are
//   --github-output <name> append the body to $GITHUB_OUTPUT as a multi-line step output called <name>
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG, changelogSections } from "../src/shared/lib/changelog.ts";

const INSTALL_NOTES = fs.readFileSync(new URL("./release-install-notes.md", import.meta.url), "utf8").replace(/\r\n/g, "\n").trim();

/** The page body for `version`. Throws, in plain words, when there is nothing to put on the page. */
export function releaseNotes(version, { changelog = CHANGELOG, installNotes = INSTALL_NOTES } = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`"${version ?? ""}" is not a release version like 1.3.5.`);
  const sections = changelog[version] ? changelogSections(changelog[version]) : [];
  if (sections.length === 0) throw new Error(`There are no release notes for ${version}: add its entry to src/shared/lib/changelog.ts before releasing.`);
  const groups = sections.map(({ heading, notes }) => `## ${heading ?? "What's new"}\n\n${notes.map((note) => `- ${note}`).join("\n")}`);
  return [...groups, installNotes].join("\n\n");
}

function main(args) {
  const version = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--github-output");
  const body = releaseNotes(version);
  if (args.includes("--check")) {
    const sections = changelogSections(CHANGELOG[version]);
    const count = sections.reduce((n, s) => n + s.notes.length, 0);
    console.log(`Release notes for ${version}: ${sections.length} group${sections.length === 1 ? "" : "s"}, ${count} note${count === 1 ? "" : "s"}.`);
  } else if (args.includes("--github-output")) {
    const name = args[args.indexOf("--github-output") + 1];
    if (!name || name.startsWith("--")) throw new Error("--github-output needs the name of the output.");
    if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is not set, so there is nowhere to write the notes.");
    let delimiter;
    do delimiter = `RELEASE_NOTES_${crypto.randomBytes(12).toString("hex")}`; while (body.includes(delimiter));
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${body}\n${delimiter}\n`);
    console.log(`Release notes for ${version} written to the step output "${name}".`);
  } else {
    console.log(body);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(1); }
}
