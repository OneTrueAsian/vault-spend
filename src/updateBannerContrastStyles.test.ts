import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Compiled feature363 measured #5e5ce6 on #22213f at13px:3.05:1.
// Resolve the actual banner foreground declaration against the actual Default-dark
// palette; the background anchor is the retained compiled failure, not a universal backdrop claim.
it("keeps the update notice readable on its measured Default-dark background", () => {
  const app = readFileSync(new URL("./App.css", import.meta.url), "utf8");
  const css = readFileSync(new URL("./Transactions.css", import.meta.url), "utf8");
  const palette = app.match(/:root\[data-palette="transparent"\]\[data-theme="dark"\]\s*\{([^}]+)\}/)![1];
  const banner = css.match(/\.update-banner\s*\{([^}]+)\}/)![1];
  const declaration = banner.match(/(?:^|;)\s*color:\s*([^;]+);/)![1].trim();
  const variable = declaration.match(/^var\((--[\w-]+)\)$/)?.[1];
  const foreground = variable ? palette.match(new RegExp(`${variable}:\\s*(#[0-9a-f]{6})`, "i"))![1] : declaration;
  const luminance = (hex: string) => {
    const rgb = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const [high, low] = [luminance(foreground), luminance("#22213f")].sort((a, b) => b - a);
  expect((high + 0.05) / (low + 0.05)).toBeGreaterThanOrEqual(4.5);
});
