import { readFileSync } from "node:fs";

/** Read local CSS imports in cascade order so source guards cover split stylesheets. */
export function readCssWithImports(url: URL): string {
  return readFileSync(url, "utf8").replace(/@import\s+"(\.[^"]+)"\s*;/g, (_match, path: string) =>
    readCssWithImports(new URL(path, url)),
  );
}

/** App's eager imports define the base cascade before any lazy view opens. */
export function readAppStyles(includeFuturistic = true): string {
  const appUrl = new URL("./App.tsx", import.meta.url);
  const app = readFileSync(appUrl, "utf8");
  return [...app.matchAll(/^import "(\.\/[^"]+\.css)";/gm)]
    .filter((match) => includeFuturistic || !match[1].endsWith("/futuristic.css"))
    .map((match) => readCssWithImports(new URL(match[1], appUrl)))
    .join("\n");
}
