import { describe, expect, it } from "vitest";
import fixtures from "../core/tests/fixtures/profile_ipc.json";
import {
  validateLeftovers,
  validateRecoveryDisplay,
  validateSetupChallenge,
  validateStartupState,
} from "./profileContracts";

describe("profile IPC contracts", () => {
  it("accepts every Rust startup variant and journal refusal without inventing an open state", () => {
    for (const state of fixtures.startup) expect(validateStartupState(state)).toEqual(state);
    expect(validateSetupChallenge(fixtures.challenge)).toEqual(fixtures.challenge);
    expect(validateRecoveryDisplay(fixtures.challenge.recovery_display)).toBe(fixtures.challenge.recovery_display);
    expect(validateLeftovers(fixtures.leftovers)).toEqual(fixtures.leftovers);
  });

  it("refuses unknown or incomplete states and malformed nested profile/error fields", () => {
    const selector = fixtures.startup.find((state) => state.status === "selector")!;
    const error = fixtures.startup.find((state) => state.status === "error")!;
    for (const bad of [
      null,
      [],
      {},
      { status: "unlocked" },
      { status: "locked", profile_id: "a" },
      { ...selector, last_used_id: 12 },
      { ...selector, profiles: [{ id: "a", name: "A", icon_key: null }] },
      { ...selector, profiles: [selector.profiles![0], selector.profiles![0]] },
      { ...error, error: { ...error.error, kind: "unknown_error" } },
      { ...error, error: { ...error.error, can_restore_registry: "yes" } },
      { ...error, error: { ...error.error, other_profiles: [{ id: null, name: "A" }] } },
    ]) {
      expect(() => validateStartupState(bad)).toThrowError(expect.objectContaining({ code: "invalid_response" }));
    }
  });

  it("refuses unsafe recovery challenges without putting the token or recovery text in errors", () => {
    for (const bad of [
      { ...fixtures.challenge, token: "" },
      { ...fixtures.challenge, challenge_group_indices: [0, 0] },
      { ...fixtures.challenge, challenge_group_indices: [0, 7] },
      { ...fixtures.challenge, challenge_group_indices: [0, 1, 2] },
      { ...fixtures.challenge, recovery_display: "private-malformed-recovery-value" },
    ]) {
      try {
        validateSetupChallenge(bad);
        throw Error("accepted malformed challenge");
      } catch (error) {
        expect(error).toMatchObject({ code: "invalid_response" });
        expect(String(error)).not.toContain(fixtures.challenge.token);
        expect(String(error)).not.toContain("private-malformed-recovery-value");
      }
    }
    expect(() => validateRecoveryDisplay("not-a-recovery-code")).toThrow();
  });

  it("refuses unknown cleanup kinds, nonpaths and unsafe byte counts", () => {
    for (const bad of [
      null,
      [{ ...fixtures.leftovers[0], kind: "anything" }],
      [{ ...fixtures.leftovers[0], path: "" }],
      [{ ...fixtures.leftovers[0], size_bytes: -1 }],
      [{ ...fixtures.leftovers[0], size_bytes: Number.MAX_SAFE_INTEGER + 1 }],
    ])
      expect(() => validateLeftovers(bad)).toThrowError(expect.objectContaining({ code: "invalid_response" }));
  });
});
