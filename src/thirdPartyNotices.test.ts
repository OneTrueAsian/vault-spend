import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const normalize = (text: string) => text.replace(/\r\n/g, "\n");
const notices = normalize(readFileSync("docs/THIRD-PARTY-NOTICES.txt", "utf8"));
const passwordListLicence = normalize(readFileSync("src-tauri/src/protection/COMMON_PASSWORDS_LICENSE.txt", "utf8"));

describe("third-party notices shown in Help", () => {
  it("credit the common-password list with its source, copyright line and full MIT licence", () => {
    expect(notices).toContain("SecLists");
    expect(notices).toContain("https://github.com/danielmiessler/SecLists");
    expect(notices).toContain("Copyright (c) 2018 Daniel Miessler");
    const mitText = passwordListLicence.slice(passwordListLicence.indexOf("Permission is hereby granted"));
    expect(mitText.length).toBeGreaterThan(500);
    expect(notices).toContain(mitText.trim());
  });
});
