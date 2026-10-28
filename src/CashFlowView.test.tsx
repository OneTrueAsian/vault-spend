// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CashFlowView } from "./CashFlowView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { host=document.createElement("div"); document.body.append(host); root=createRoot(host); });
afterEach(() => { act(()=>root.unmount()); host.remove(); });
function show(income="0", expense="0", compare=false) {
  const months=[{year:2026,month:10,month_label:"Oct",income,expense}];
  const flow={months,top_categories:[],top_merchants:[],total_income:income,total_expense:expense};
  const p: ComponentProps<typeof CashFlowView>={cashFlow:flow,range:3,onSetRange:vi.fn(),compareLastYear:compare,onToggleCompareLastYear:vi.fn(),yoyCashFlow:compare?{current:months,prior_year:[{...months[0],income:"10",expense:"5"}]}:null,onMonthClick:vi.fn(),topCategoriesData:flow,topCategoriesMonth:{year:2026,month:10},onSetTopCategoriesMonth:vi.fn(),previousMonthCategorySpending:[],forecastData:null,forecastDays:30,onSetForecastDays:vi.fn(),accounts:[],onSetAccountInterestRate:vi.fn(),onCalculateDebtPayoff:vi.fn(),onSetAccountExcludedFromDebtPayoff:vi.fn(),layoutWidgets:[],onPinWidget:vi.fn()};
  act(()=>root.render(<CashFlowView {...p}/>));
}
it("explains an empty period without invented currency ticks or a nonexistent bar action",()=>{
  show();
  expect(host.textContent).toContain("No income or spending in this period.");
  expect(host.querySelectorAll(".chart-bar")).toHaveLength(0);
  expect(host.textContent).not.toContain("Click a bar");
});
it("responds to changed inputs and retains a prior-year-only comparison",()=>{
  show(); show("100","20");
  expect(host.querySelectorAll(".chart-bar").length).toBeGreaterThan(0);
  expect(host.textContent).toContain("Click a bar");
  show("0","0",true);
  expect(host.querySelectorAll(".chart-bar").length).toBeGreaterThan(0);
  expect(host.textContent).not.toContain("No income or spending in this period.");
});
