import { describe, expect, it } from "vitest";
import { CHANGED_BODY, CHANGED_HEADING } from "./changedState";
import { explainFailure } from "./controller";
import { explainRetirementFailure } from "./retirementNativeContract";
import { RETIREMENT_CHANGED_MESSAGE } from "./retirementScreenContract";
import { TransactionError } from "../transactionContracts";

/** D-S3-04 (UC-06): one heading and one body for every "your data changed" state, in every family. */
describe("the shared changed-state wording", () => {
  it("is exactly what the owner decided", () => {
    expect(CHANGED_HEADING).toBe("Your details changed");
    expect(CHANGED_BODY).toBe("This answer or preview is no longer shown. Ask again using your current details.");
  });
  it.each(["stale_profile", "profile_locked", "no_profile_open", "superseded", "stale_data"])("an ordinary question that went stale (%s) says the shared body", code => {
    expect(explainFailure(new TransactionError(code as never, "x"))).toEqual({ status: "stale", message: CHANGED_BODY });
  });
  it.each(["stale_profile", "profile_locked", "no_profile_open", "superseded", "stale_data"])("an extra-money read that went stale (%s) says the shared body", code => {
    expect(explainRetirementFailure(new TransactionError(code as never, "x"))).toEqual({ status: "stale", message: CHANGED_BODY });
  });
  it("an investment account that is gone keeps its own instruction beneath the shared body", () => {
    const got = explainRetirementFailure(new TransactionError("account_unavailable" as never, "x"));
    expect(got.status).toBe("stale");
    expect(got.message.startsWith(CHANGED_BODY + " ")).toBe(true);
    expect(got.message).toContain("That investment account is no longer available.");
  });
  it("the extra-money screen's own message is the shared body", () => {
    expect(RETIREMENT_CHANGED_MESSAGE).toBe(CHANGED_BODY);
  });
  it("errors that are not about changed data keep their own words", () => {
    expect(explainFailure(new TransactionError("internal" as never, "x"))).toMatchObject({ status: "error" });
    expect(explainFailure(new TransactionError("internal" as never, "x")).message).not.toContain(CHANGED_BODY);
    expect(explainRetirementFailure(new TransactionError("internal" as never, "x")).message).not.toContain(CHANGED_BODY);
  });
});
