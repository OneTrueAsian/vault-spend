import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PROTECTION_FINISH_MS } from "./protection.mjs";

// Turning password protection on runs Argon2id key derivation and encrypted exports. A hosted runner that is several times slower than the
// serial one (seen in the sharded gate) failed specs that gave that work only 10 to 15 seconds. Every wait that follows it shares one allowance.
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const allSpecs = fs.readdirSync(new URL("../", import.meta.url)).filter(f => /^feature\d+.*\.mjs$/.test(f));
const specs = ["feature114_regenerate_recovery.mjs", "feature123_window_lock_triggers.mjs", "feature124_system_session_lock.mjs", "feature133_generation_rearm_after_swap.mjs", "feature286_manual_lock_confirmation.mjs"];

// The two ways a spec waits for protection setup to finish: the settings page saying so, or a button that only exists once it is on.
function shortWaits(source) {
  const lines = source.split(/\r?\n/), found = [];
  lines.forEach((line, i) => {
    const call = lines.slice(i, i + 3).join(" ");
    const state = /Password protection: On/.test(line) ? call.match(/timeout:\s*(\w+)/) : null;
    const button = /button=(Change password|Remove protection|Regenerate recovery key)"\)\.waitForExist\(\{\s*timeout:\s*(\d+)/.exec(line);
    const ms = Number(state?.[1] ?? button?.[2] ?? Infinity);
    if (ms < PROTECTION_FINISH_MS) found.push(`line ${i + 1}: ${ms}ms`);
  });
  return found;
}

describe("waits that follow turning password protection on", () => {
  it("share the setup allowance the conversion wait already uses", () => {
    expect(PROTECTION_FINISH_MS).toBe(45000);
    expect(read("lib/protection.mjs")).toMatch(/timeout: PROTECTION_FINISH_MS, timeoutMsg: "password protection conversion/);
  });
  it("cover the wait for the recovery key after Continue and the failpoint marker", () => {
    const source = read("lib/protection.mjs");
    expect(source).toMatch(/recoveryEl\.waitForExist\(\{ timeout: PROTECTION_FINISH_MS \}\)/);
    expect(source).toMatch(/const FAILPOINT_WAIT_MS = 90_000;/);
  });
  it.each(specs)("%s waits for the result with that allowance, not a short literal", file => {
    const source = read(file);
    expect(source).toMatch(/import \{[^}]*PROTECTION_FINISH_MS[^}]*\} from "\.\/lib\/protection\.mjs"/);
    expect(source).toMatch(/timeout: PROTECTION_FINISH_MS/);
  });
  it("recovering a profile with its code waits as long, since it derives the key again", () => {
    expect(read("feature116_recover_via_code.mjs")).toMatch(/timeout: PROTECTION_FINISH_MS, timeoutMsg: "recovery should reopen the profile directly"/);
  });
  it("no spec waits for protection setup to finish for less than that allowance", () => {
    const offenders = allSpecs.flatMap(file => shortWaits(read(file)).map(where => `${file} ${where}`));
    expect(offenders).toEqual([]);
  });
});
