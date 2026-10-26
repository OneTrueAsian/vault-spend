// How a --spec selector matches a desktop spec file name: `smoke`, a feature number, or a case-insensitive fragment of the file name.
export function matchesSelector(name, selector) {
  if (selector === "smoke") return name === "smoke.mjs";
  if (/^\d+$/.test(selector)) return name.startsWith(`feature${Number(selector)}_`);
  return name.toLowerCase().includes(selector.toLowerCase());
}
