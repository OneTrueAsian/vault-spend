// Errors reach people through one formatter (2026-10-02 QA, M7). Backend messages written for people
// pass through unchanged; internal ones (database constraints, file system errors, status codes) are
// put into plain words instead of being shown as is.
import { describe, expect, it } from "vitest";
import { errorMessage } from "./errorMessage";

describe("errorMessage", () => {
  it("passes a message written for people through unchanged", () => {
    expect(errorMessage('You already have an account called "Car Loan". Choose a different name.')).toBe(
      'You already have an account called "Car Loan". Choose a different name.',
    );
    expect(errorMessage(new Error("Enter an amount like 12.34."))).toBe("Enter an amount like 12.34.");
  });

  it("drops the internal status code in front of a message", () => {
    expect(errorMessage("PROFILE_LOCKED: This profile is locked. Unlock it to continue.")).toBe("This profile is locked. Unlock it to continue.");
    expect(errorMessage("NO_PROFILE_OPEN: No profile is open.")).toBe("No profile is open.");
  });

  it("puts database errors into plain words", () => {
    expect(errorMessage("UNIQUE constraint failed: categories.name")).toBe("That name is already in use. Choose a different one.");
    expect(errorMessage("FOREIGN KEY constraint failed")).toBe("Something else still uses this, so it can't be changed that way.");
    expect(errorMessage("database is locked")).toBe("Vault Spend is busy saving. Try again in a moment.");
  });

  it("puts file errors into plain words", () => {
    expect(errorMessage("The system cannot find the file specified. (os error 2)")).toBe("That file couldn't be found. It may have been moved or deleted.");
    expect(errorMessage("Access is denied. (os error 5)")).toBe(
      "Vault Spend wasn't allowed to use that file. Check that it isn't open in another program.",
    );
  });

  it("handles things that aren't strings or errors", () => {
    expect(errorMessage(undefined)).toBe("Something went wrong. Try again.");
    expect(errorMessage({ message: "Enter a name." })).toBe("Enter a name.");
  });
});
