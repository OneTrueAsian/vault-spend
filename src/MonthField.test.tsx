// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MonthField } from "./MonthField";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("preserves native month validation, ISO storage, label and formatted empty/editing states", () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); const change = vi.fn();
  act(() => root.render(<MonthField aria-label="Withdraw month" value="2026-10" min="2026-10" onChange={change} />));
  const input = host.querySelector("input")!; expect(input.type).toBe("month"); expect(input.value).toBe("2026-10"); expect(input.min).toBe("2026-10");
  expect(host.querySelector(".date-field-text")!.textContent).toBe("Oct 2026");
  act(() => input.focus()); expect(host.querySelector(".date-field-editing")).not.toBeNull(); act(() => input.blur()); expect(host.querySelector(".date-field-editing")).toBeNull();
  act(() => root.render(<MonthField aria-label="Withdraw month" value="" onChange={change} />)); expect(host.querySelector(".date-field-text")!.textContent).toBe("Pick a month");
  act(() => root.unmount()); host.remove();
});
