// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { maskAmounts, PRIVACY_MASK, startPrivacyMask } from "./privacy";

describe("maskAmounts", () => {
  it("hides plain, negative and grouped dollar amounts", () => {
    expect(maskAmounts("$12")).toBe(PRIVACY_MASK);
    expect(maskAmounts("$1,234.56")).toBe(PRIVACY_MASK);
    expect(maskAmounts("-$1,234.56")).toBe(PRIVACY_MASK);
  });

  it("hides abbreviated amounts", () => {
    expect(maskAmounts("$1.2k")).toBe(PRIVACY_MASK);
    expect(maskAmounts("$3.4M")).toBe(PRIVACY_MASK);
  });

  it("hides amounts inside a sentence and leaves the words alone", () => {
    expect(maskAmounts("Groceries is $120.50 over, needs $600/mo")).toBe(`Groceries is ${PRIVACY_MASK} over, needs ${PRIVACY_MASK}/mo`);
  });

  it("leaves text without a dollar amount untouched", () => {
    expect(maskAmounts("42% funded, 12 days left")).toBe("42% funded, 12 days left");
    expect(maskAmounts("Costs $ (varies)")).toBe("Costs $ (varies)");
  });
});

describe("startPrivacyMask", () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
    document.body.innerHTML = "";
  });

  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("masks amounts already on the page and puts them back when stopped", () => {
    document.body.innerHTML = `<p id="a">Balance $1,000.00</p><p id="b">No money here</p>`;

    stop = startPrivacyMask(document.body);

    expect(document.getElementById("a")!.textContent).toBe(`Balance ${PRIVACY_MASK}`);
    expect(document.getElementById("b")!.textContent).toBe("No money here");
    stop();
    stop = null;
    expect(document.getElementById("a")!.textContent).toBe("Balance $1,000.00");
  });

  it("masks amounts that appear afterwards, and text that changes", async () => {
    document.body.innerHTML = `<div id="root"><p id="a">Total: 0</p></div>`;
    stop = startPrivacyMask(document.body);

    const added = document.createElement("p");
    added.textContent = "New charge -$45.00";
    document.getElementById("root")!.appendChild(added);
    document.getElementById("a")!.firstChild!.nodeValue = "Total: $9,999.99";
    await flush();

    expect(added.textContent).toBe(`New charge ${PRIVACY_MASK}`);
    expect(document.getElementById("a")!.textContent).toBe(`Total: ${PRIVACY_MASK}`);
  });

  it("restores the latest real text, not a stale one, after a masked node was updated", async () => {
    document.body.innerHTML = `<p id="a">$1.00</p>`;
    stop = startPrivacyMask(document.body);
    document.getElementById("a")!.firstChild!.nodeValue = "$2.00";
    await flush();

    stop();
    stop = null;

    expect(document.getElementById("a")!.textContent).toBe("$2.00");
  });

  it("leaves what a person is typing alone", () => {
    document.body.innerHTML = `<textarea id="t">$5.00</textarea><p data-privacy-ignore>$7.00</p>`;

    stop = startPrivacyMask(document.body);

    expect((document.getElementById("t") as HTMLTextAreaElement).value).toBe("$5.00");
    expect(document.querySelector("[data-privacy-ignore]")!.textContent).toBe("$7.00");
  });
});
