import { describe, expect, it } from "vitest";
import { statusLifetimeMs } from "./statusLifetime";

// VS-53: an error stays until the person dismisses it (or a newer message replaces it); routine messages still fade.
describe("how long a status message stays", () => {
  it("keeps an error until it is dismissed", () => expect(statusLifetimeMs("error")).toBeNull());
  it("fades a confirmation and an in-progress note after ten seconds", () => {
    expect(statusLifetimeMs("success")).toBe(10000);
    expect(statusLifetimeMs("info")).toBe(10000);
  });
});
