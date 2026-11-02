// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("allows long exact money values to wrap within their flex tile instead of using intrinsic overflow",()=>{
 const style=document.createElement("style");style.textContent=readFileSync("src/DashboardCards.css","utf8");document.head.append(style);
 const tile=document.createElement("button");tile.className="stat";tile.style.width="200px";
 const money=document.createElement("span");money.className="stat-value";money.textContent="-$9,999,999,002.99";tile.append(money);document.body.append(tile);
 tile.style.whiteSpace="nowrap"; // SharedButtons.css applies this to clickable tiles.
 try {const css=getComputedStyle(money);expect(css.whiteSpace).toBe("normal");expect(css.maxWidth).toBe("100%");expect(parseFloat(css.minWidth)).toBe(0);expect(css.overflowWrap).toBe("anywhere");expect(money.textContent).toBe("-$9,999,999,002.99");}
 finally {tile.remove();style.remove();}
 // jsdom does not lay out glyphs. Compiled geometry and exact text are a separate required check.
});
