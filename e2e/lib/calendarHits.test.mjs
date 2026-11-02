import { describe, expect, it } from "vitest";
import { splitTargetSizeFindings } from "./calendarHits.mjs";

const node = (reasons, ...inside) => ({ node: ".calendar-day", reasons, related: inside.map((i) => ({ inside: i, html: "<button>" })) });
const OBSCURED = "Target has insufficient size because it is partially obscured (smallest space is 38px by 2.2px)";
const NEIGHBOURS = "Target has insufficient space to its closest neighbors. Safe clickable space has a diameter of 2.2px";

describe("splitTargetSizeFindings", () => {
  it("accepts a target obscured by something outside the calendar", () => {
    const { accepted, failing } = splitTargetSizeFindings([node([OBSCURED], false)]);
    expect(accepted).toHaveLength(1);
    expect(failing).toHaveLength(0);
  });
  it("accepts the same obscuring reported again as lost spacing, with a sibling day named as a neighbour", () => {
    expect(splitTargetSizeFindings([node([OBSCURED, NEIGHBOURS], false, true, false)]).accepted).toHaveLength(1);
  });
  it("keeps a target as a failure when nothing outside the calendar is the cause", () => {
    expect(splitTargetSizeFindings([node([OBSCURED], true)]).failing).toHaveLength(1);
    expect(splitTargetSizeFindings([node([OBSCURED])]).failing).toHaveLength(1);
  });
  it("keeps a spacing-only finding, because that is a real layout problem rather than obscuring", () => {
    expect(splitTargetSizeFindings([node([NEIGHBOURS], false, true)]).failing).toHaveLength(1);
  });
  it("keeps a target that is also too small", () => {
    expect(splitTargetSizeFindings([node(["Target has insufficient size (20px by 20px)"], false)]).failing).toHaveLength(1);
    expect(splitTargetSizeFindings([node([OBSCURED, "Target has insufficient size (20px by 20px)"], false)]).failing).toHaveLength(1);
  });
});
