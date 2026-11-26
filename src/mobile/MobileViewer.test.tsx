// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fixture from "../../core/tests/fixtures/mobile_snapshot_v1.json";
import comparisonsFixture from "../../core/tests/fixtures/mobile_snapshot_comparisons_v1.json";
import emptyFixture from "../../core/tests/fixtures/mobile_snapshot_empty_v1.json";
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
    const click = (label: string) => act(() => { const button = [...container.querySelectorAll("button")].find(b => b.textContent?.trim() === label || b.getAttribute("aria-label") === label); if (!button)
        throw new Error(label); button.click(); });
    const render = () => act(() => root.render(<MobileViewer snapshots={[snapshot, { ...snapshot, profile: { ...snapshot.profile, id: "second", name: "Second" }, accounts: [], budgets: [] }]}/>));
    it("keeps Overview to three accounts and remembers selections per profile", () => {
        const second = { ...snapshot, profile: { ...snapshot.profile, id: "second", name: "Second" } };
        const show = () => act(() => root.render(<MobileViewer snapshots={[snapshot, second]}/>));
        const names = () => [...container.querySelectorAll(".mobile-account-preview .mobile-account-name strong")].map(el => el.textContent);
        show();
        const initial = names();
        expect(initial).toHaveLength(3);
        expect(container.querySelector(".mobile-account-preview")?.textContent).not.toContain("Loan");
        const picker = container.querySelector<HTMLDetailsElement>(".mobile-account-picker")!;
        act(() => { picker.open = true; picker.dispatchEvent(new Event("toggle")); });
        const choices = [...picker.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
        const choice = (name: string) => choices.find(input => input.labels?.[0].textContent?.trim().startsWith(name))!;
        expect(choice("Loan").disabled).toBe(true);
        act(() => choice("Checking").click());
        act(() => choice("Loan").click());
        expect(names()).toEqual(["Savings", "Credit", "Loan"]);
        act(() => { root.unmount(); });
        root = createRoot(container);
        show();
        expect(names()).toEqual(["Savings", "Credit", "Loan"]);
        click(`Profile: ${snapshot.profile.name}`);
        click("Second");
        expect(names()).toEqual(initial);
        click("See all accounts");
        expect(container.textContent).toContain("Investment");
    });
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
    it("shows the credit card amount owed as its balance and keeps available credit distinct", () => {
        render();
        expect(container.textContent).toContain("Credit card balance");
        expect(container.textContent).toContain("$400.00");
        expect(container.textContent).not.toContain("Ledger balance");
        click("Accounts");
        const card = [...container.querySelectorAll("details")].find(el => el.querySelector("summary")?.textContent?.includes("Credit card balance"));
        expect(card?.querySelector("summary")?.textContent).toContain("$400.00");
        expect(card?.querySelector("summary")?.textContent).not.toContain("$4,600.00");
        expect(card?.textContent).toContain("Available credit$4,600.00");
        expect(card?.textContent).toContain("Credit limit$5,000.00");
        click("Hide amounts");
        expect(container.innerHTML).not.toMatch(/\$[\d,]+\.\d{2}/);
    });
    it("shows recorded income on Overview and keeps planned income in Budget", () => {
        const s = structuredClone(snapshot);
        const budget = s.budgets.find(item => item.month === s.asOfDate.slice(0, 7))!;
        budget.actualIncome = "1200";
        budget.lines.find(line => line.group === "income")!.effectiveBudget = "2400";
        act(() => root.render(<MobileViewer snapshots={[s]}/>));
        expect(container.textContent).toContain("Income received this month$1,200.00");
        expect(container.querySelector(".mobile-overview-metrics")?.textContent).not.toContain("$2,400.00");
        click("Budget");
        expect(container.textContent).toContain("Planned income$2,400.00");
    });
    it("explains saved prices without exposing internal reason codes", () => {
        const s = structuredClone(snapshot);
        s.sections.investments.reason = "saved_prices_without_per_position_timestamps";
        act(() => root.render(<MobileViewer snapshots={[s]}/>));
        click("Accounts");
        expect(container.textContent).toContain("Prices from your saved snapshot");
        expect(container.textContent).toContain("Price update times aren’t available");
        expect(container.textContent).not.toContain("saved_prices_without_per_position_timestamps");
    });
    it("puts the budget overview first and retains plan detail without using gross spending as category actuals", () => {
        const s = structuredClone(snapshot);
        const budget = s.budgets.find(item => item.month === "2026-10")!;
        const expense = budget.lines.find(line => line.group !== "income")!;
        expense.actual = "100.00";
        expense.remaining = "500.00";
        budget.actualSpending = "225.00";
        budget.unbudgetedSpending = "75.00";
        act(() => root.render(<MobileViewer snapshots={[s]}/>));
        click("Budget");
        expect(container.textContent).toContain("Left in the spending plan");
        expect(container.textContent).toContain("Category spending$100.00");
        expect(container.textContent).toContain("Spending recorded$225.00");
        expect(container.textContent).toContain("Unbudgeted spending$75.00");
        expect(container.textContent).toContain("Budget details");
        expect(container.textContent).not.toContain("Status: none");
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
    // VS-65: the Spending dot was drawn in the muted text colour while its bars use the second chart colour.
    it("draws the legend's Spending dot in the spending bars' colour, keeping the word readable", () => {
        render();
        click("Reports");
        const dot = container.querySelector(".mobile-legend .mobile-legend-spending-dot");
        expect(dot?.textContent).toBe("●");
        expect(dot?.getAttribute("aria-hidden")).toBe("true");
        expect(container.querySelector(".mobile-legend")?.textContent).toBe("● Income ● Spending");
        const css = readFileSync("src/mobile/MobileViewer.css", "utf8");
        const rule = (selector: string) => { const start = css.indexOf(selector + " {"); return start < 0 ? "" : css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start)); };
        const barColour = rule(".mobile-bars i:nth-child(2)").match(/background:\s*([^;]+);/)?.[1];
        expect(barColour).toBeTruthy();
        expect(rule(".mobile-legend-spending-dot")).toContain(`color: ${barColour};`);
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
    it("shows just three snapshot months of net worth and seven calendar days of portfolio records", () => {
        const s = structuredClone(snapshot);
        s.history.netWorth = ["2026-07-31", "2026-08-31", "2026-09-30", "2026-10-04"].map(date => ({ ...snapshot.history.netWorth[0], date }));
        s.history.portfolio = ["2026-09-27", "2026-09-28", "2026-10-01", "2026-10-04"].map(date => ({ ...snapshot.history.portfolio[0], date }));
        act(() => root.render(<MobileViewer snapshots={[s]}/>));
        click("Reports");
        const report = (title: string) => [...container.querySelectorAll("section")].find(el => el.querySelector(":scope > h2")?.textContent === title)!;
        expect([...report("Net worth history").querySelectorAll("time")].map(el => el.dateTime)).toEqual(["2026-10-04", "2026-09-30", "2026-08-31"]);
        expect([...report("Portfolio history").querySelectorAll("time")].map(el => el.dateTime)).toEqual(["2026-10-04", "2026-10-01", "2026-09-28"]);
        expect(report("Net worth history").querySelector("[aria-label='Net worth by saved date']")).not.toBeNull();
        expect(report("Portfolio history").querySelector("[aria-label='Portfolio value by saved date']")).not.toBeNull();
        click("Hide amounts");
        expect(report("Net worth history").querySelector("svg[role='img']")).toBeNull();
        expect(report("Portfolio history").querySelector("svg[role='img']")).toBeNull();
        expect(container.innerHTML).not.toMatch(/\$[\d,]+\.\d{2}/);
        click("Report range: 12 months");
        click("Last month");
        expect(report("Net worth history").querySelectorAll("time")).toHaveLength(3);
        expect(report("Portfolio history").querySelectorAll("time")).toHaveLength(3);
        expect(container.textContent).not.toMatch(/heatmap/i);
    });
    it("shows empty history messages when no recent points were recorded",()=>{
        const s=parseMobileSnapshot(JSON.stringify(emptyFixture));
        s.history.portfolio = [{ date: "2026-08-01", value: "100" }];
        act(()=>root.render(<MobileViewer snapshots={[s]}/>));click("Reports");
        expect(container.textContent).toContain("No months available");
        expect(container.textContent).toContain("No net worth history saved in the last three months.");
        expect(container.textContent).toContain("No portfolio values saved in the last seven days.");
    });
});
