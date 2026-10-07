// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fixture from "../core/tests/fixtures/mobile_snapshot_v1.json";
import comparisonsFixture from "../core/tests/fixtures/mobile_snapshot_comparisons_v1.json";
import emptyFixture from "../core/tests/fixtures/mobile_snapshot_empty_v1.json";
import { parseMobileSnapshot } from "./mobileSnapshot";
import { MobileViewer } from "./MobileViewer";
(globalThis as {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;
describe("read-only mobile viewer", () => {
    let container: HTMLDivElement, root: Root;
    const snapshot = parseMobileSnapshot(JSON.stringify(fixture));
    beforeEach(() => { localStorage.clear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
    afterEach(() => { act(() => root.unmount()); container.remove(); });
    const click = (label: string) => act(() => { const button = [...container.querySelectorAll("button")].find(b => b.textContent === label || b.getAttribute("aria-label") === label); if (!button)
        throw new Error(label); button.click(); });
    const render = () => act(() => root.render(<MobileViewer snapshots={[snapshot, { ...snapshot, profile: { ...snapshot.profile, id: "second", name: "Second" }, accounts: [], budgets: [] }]}/>));
    it("renders every account and category, and resets page state when changing profiles", () => {
        render();
        click("Accounts");
        for (const a of snapshot.accounts)
            expect(container.textContent).toContain(a.name);
        click("Budget");
        for (const l of snapshot.budgets.find(b => b.month === snapshot.asOfDate.slice(0, 7))?.lines ?? [])
            expect(container.textContent).toContain(l.category);
        click(`Profile: ${snapshot.profile.name}`);
        click("Second");
        expect(container.querySelector("h1")?.textContent).toBe("Your money at a glance");
        expect(container.textContent).not.toContain(snapshot.accounts[0]?.name);
    });
    it("redacts values from chart accessibility labels and month details", () => {
        render();
        click("Reports");
        const bar = container.querySelector<HTMLButtonElement>(".mobile-chart button")!;
        act(() => bar.click());
        expect(container.querySelector(".mobile-month-detail")?.textContent).toContain("Income");
        click("Hide amounts");
        expect(container.querySelector(".mobile-chart button")?.getAttribute("aria-label")).toContain("••••");
        expect(container.querySelector(".mobile-month-detail")?.textContent).not.toMatch(/\$/);
        expect(container.innerHTML).not.toMatch(/\$[\d,]+\.\d{2}/);
    });
    it("labels the Where it went charts with each category's name and amount, on screen", () => {
        render();
        click("Reports");
        const key = [...container.querySelectorAll(".mobile-donut-key li")].map(li => li.textContent);
        expect(key.length).toBeGreaterThan(0);
        expect(key[0]).toMatch(/^Groceries\$[\d,]+\.\d{2}\d+%$/);
        expect(container.querySelector(".mobile-donut-key .mobile-swatch")).not.toBeNull();
        const flowLabels = [...container.querySelectorAll(".mobile-sankey text")].map(t => t.textContent);
        expect(flowLabels.some(t => /^Income/.test(t ?? ""))).toBe(true);
        expect(flowLabels.some(t => /^Groceries/.test(t ?? ""))).toBe(true);
        expect(flowLabels.join(" ")).toMatch(/\$[\d,]+\.\d{2}/);
        click("Hide amounts");
        expect(container.querySelector(".mobile-donut-key")).toBeNull();
        expect(container.querySelector(".mobile-sankey")).toBeNull();
    });
    it("uses themed menus and persists only appearance choices", () => {
        render();
        click("Settings");
        click("Theme: Default");
        click("Retro");
        expect(document.documentElement.dataset.palette).toBe("retro");
        expect(localStorage.getItem("vault-mobile-palette")).toBe("retro");
        expect(container.querySelector("select")).toBeNull();
        expect([...Array(localStorage.length)].map((_, i) => localStorage.key(i))).toEqual(["vault-mobile-palette"]);
    });
    it("has an honest empty state without fabricated balances or network calls", () => {
        act(() => root.render(<MobileViewer snapshots={[]}/>));
        expect(container.textContent).toContain("No saved snapshot");
        expect(container.textContent).not.toMatch(/\$/);
    });
    it("keeps connection and appearance controls in Settings, with refresh still usable", () => {
        let refreshed = false;
        act(() => root.render(<MobileViewer snapshots={[snapshot]} onRefresh={() => { refreshed = true; }} connectionControls={<button>Pair this phone</button>}/>));
        expect(container.textContent).not.toContain("Pair this phone");
        expect(container.querySelector(".mobile-sync")).toBeNull();
        expect(container.querySelector(".mobile-nav")?.textContent).toContain("Settings");
        click("Settings");
        expect(container.querySelector("h1")?.textContent).toBe("Settings");
        expect(container.textContent).toContain("Pair this phone");
        expect(container.textContent).toContain("Snapshot as of");
        expect(container.querySelector(".mobile-sync small")?.textContent).toContain("Saved Oct 4");
        click("Refresh");
        expect(refreshed).toBe(true);
        click("Overview");
        expect(container.querySelector("h1")?.textContent).toBe("Your money at a glance");
        expect(container.textContent).not.toContain("Pair this phone");
    });
    it("lets an unpaired phone open Settings to pair", () => {
        act(() => root.render(<MobileViewer snapshots={[]} connectionControls={<button>Pair this phone</button>}/>));
        click("Settings");
        expect(container.textContent).toContain("Pair this phone");
    });
    it("opens Settings for pairing links and keeps it open when a snapshot arrives", () => {
        act(() => root.render(<MobileViewer snapshots={[]} initialSettingsOpen connectionControls={<button>Pair this phone</button>}/>));
        expect(container.querySelector("h1")?.textContent).toBe("Settings");
        expect(container.textContent).toContain("Pair this phone");
        act(() => root.render(<MobileViewer snapshots={[snapshot]} initialSettingsOpen/>));
        expect(container.querySelector("h1")?.textContent).toBe("Settings");
        expect(container.querySelector(".mobile-sync")).not.toBeNull();
    });
    it("discards unsaved calculator inputs on profile switch and snapshot replacement", () => {
        render();
        click("Calculators");
        const field = container.querySelector<HTMLInputElement>("input")!;
        act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "777"); field.dispatchEvent(new Event("input", { bubbles: true })); });
        expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("777");
        click(`Profile: ${snapshot.profile.name}`);
        click("Second");
        click("Calculators");
        expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("1000");
        act(() => root.render(<MobileViewer snapshots={[{ ...snapshot, sequence: "2" }]}/>));
        expect(container.querySelector("h1")!.textContent).toBe("Your money at a glance");
    });
    it("retains missing section reasons and hides calculator inputs as well as outputs", () => {
        act(() => root.render(<MobileViewer snapshots={[{ ...snapshot, sections: { ...snapshot.sections, reports: { state: "unavailable", reason: "History could not be captured" } } }]}/>));
        click("Reports");
        expect(container.textContent).toContain("History could not be captured");
        expect(container.querySelector(".mobile-chart")).toBeNull();
        click("Calculators");
        click("Hide amounts");
        expect(container.querySelector("input[type='text']")).toBeNull();
        expect(container.innerHTML).not.toMatch(/\$[\d,]+\.\d{2}/);
    });
    it("renders saved comparison results and provenance without setup controls",()=>{
        const s=parseMobileSnapshot(JSON.stringify(comparisonsFixture));
        s.comparisons.cards[0].secondary.push({label:"Me: Personal income",result:structuredClone(s.comparisons.cards[0].result)});
        act(()=>root.render(<MobileViewer snapshots={[s]}/>));click("Reports");
        const card=s.comparisons.cards[0];
        expect(container.textContent).toContain(card.result.status);
        expect(container.textContent).toContain(card.result.reference!.sourceUrl);
        expect(container.textContent).toContain(card.secondary[0].label);
        click("Hide amounts");expect(container.innerHTML).not.toMatch(/\$[\d,]+\.\d{2}/);
        expect(container.querySelector("input")).toBeNull();
    });
    it("does not invent heatmap days when no report history was captured",()=>{
        const s=parseMobileSnapshot(JSON.stringify(emptyFixture));
        act(()=>root.render(<MobileViewer snapshots={[s]}/>));click("Reports");
        expect(container.textContent).toContain("No months available");
        expect(container.querySelectorAll(".mobile-heatmap button")).toHaveLength(0);
    });
});
