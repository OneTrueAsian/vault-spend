import { date as isDate } from "../contractChecks";
import { dateOutOfRange } from "../dateRange";
import { distance } from "./distance";
import { daysInMonth, isoDate } from "./calendar";
import { parseSpendingScenario } from "./spendingScenarioParser";
import { EXTRA_MARKER, RETIREMENT_WORDS, SAVING_LEAD, ordinaryOperatorStore, namesInvestmentAccount } from "./savingLead";
import { validateScenarioIntent } from "./spendingScenarioContract";
import type { CutPreviewCategory, CutPreviewDraft, ParseCutPreview } from "./cutPreviewContract";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const months = "january february march april may june july august september october november december".split(" ");
const number = "(?:[1-9]\\d{0,2}(?:,\\d{3})+|0|[1-9]\\d*)(?:\\.\\d{1,2})?";
const cash = `(?:\\$\\s*(${number})|(${number})\\s*(?:dollars?|\\$))(?![\\d,eE]|\\.\\d)`;
const entityPattern = (label: string) => {
  const name = escape(label.replace(/[‘’]/g, "'")).replace(/\s+/g, "\\s+");
  return `(?:"${name}"|${name})(?![\\p{L}\\p{N}])`;
};

/** Bounded target grammar; every remaining clause must pass the existing schedule grammar. */
export const parseCutPreview: ParseCutPreview = (text, context) => {
  const original = text.replace(/[‘’]/g, "'");
  let rest = original;
  // A question that begins with a known store's full name is an ordinary spending question, whatever words the name holds (M6 D-S4-02).
  const unsupported = (reason: string) => ({ kind: "cut-preview-unsupported" as const, reason });
  if (/^(?:please\s+)?(?:invest (?:the|my|our) savings\b|apply (?:these|the) cuts\b|(?:(?:cut|use) (?:the )?)?(?:fewest|fewer) categories\b)/iu.test(rest.trim())) {
    return unsupported("Investing savings, applying cuts and choosing the fewest categories are not supported. This read-only preview can spread a monthly savings target across explicitly selected categories.");
  }
  const goal = /^(?:please\s+)?(?:(?:where|how|what)\s+(?:can|could|should)\s+(?:i|we)\s+(?:cut back|reduce spending)\s+to\s+save|(?:how|where)\s+(?:can|could)\s+(?:i|we)\s+save|(?:can you\s+)?help (?:me|us) save|(?:i|we) want to save|save)\b/iu.exec(rest.trimStart());
  const discovery = /^which categories can (?:i|we) cut[?.!]?\s*$/iu.test(rest.trim());
  const namedDiscovery = /^cut (?:my|our)\s+/iu.exec(rest.trimStart());
  const categoryDiscovery = !!namedDiscovery && /\s+to save money[.?!]?\s*$/iu.test(rest);
  if (!goal && !discovery && !categoryDiscovery) return null;
  if (ordinaryOperatorStore(original, context)) return null;
  // "Save $50 a month into my Roth IRA" names an investment account, not a savings target: the extra-money reader asks what is meant (M6 D-S3-01).
  if (goal && SAVING_LEAD.test(rest) && namesInvestmentAccount(original, context)) return null;
  // "Save an extra $50 a month for retirement" states additional money for an investment account without naming one: the extra-money flow
  // asks which account and when (M6 D-S4-01). Words inside quoted names do not count.
  if (goal && SAVING_LEAD.test(rest)) {
    const outsideQuotes = original.replace(/"[^"\r\n]*"/g, q => " ".repeat(q.length));
    if (EXTRA_MARKER.test(outsideQuotes) && RETIREMENT_WORDS.test(outsideQuotes)) return null;
    if (/\bfor\s+(?:my\s+)?retirement\b/iu.test(outsideQuotes)) return unsupported('If you mean adding extra money to an investment account, say "Extra $50 a month for retirement". This question does not yet say whether the money is additional.');
  }
  if ([...text].length > 512) return unsupported("Keep the savings-target question to 512 characters or fewer.");
  const quotedNames = original.includes('"');
  const outsideName = (index: number) => !quotedNames || (original.slice(0, index).match(/"/g)?.length ?? 0) % 2 === 0;
  const materialMatch = (pattern: RegExp) => {
    if (!quotedNames) return pattern.test(original);
    const search = new RegExp(pattern.source, pattern.flags + "g");
    let match: RegExpExecArray | null;
    while ((match = search.exec(original))) if (outsideName(match.index)) return true;
    return false;
  };
  // A single-category cut is M3's operation, including its missing-cadence choices.
  if (!materialMatch(/\bacross\b/iu) && materialMatch(/\b(?:in|on)\s+/iu) && context.categories.some(label => {
    const quoted = materialMatch(new RegExp(`\\b(?:in|on)\\s+"${escape(label)}"`, "iu"));
    return quoted || (!months.includes(norm(label)) && materialMatch(new RegExp(`\\b(?:in|on)\\s+${entityPattern(label)}`, "iu")));
  })) return null;
  // A single category that is only misspelled is still M3's question: its clarification offers the close names (M6 D-S3-02, "existing clarification rules").
  if (!quotedNames && !materialMatch(/\bacross\b/iu)) {
    const subject = /\b(?:on|in)\s+([\p{L}][\p{L}' -]*?)(?=\s+(?:from|starting|for|monthly|each|per|a month|every|once|one[ -]time|until|through|beginning)\b|[.?!,]?\s*$)/iu.exec(original);
    const key = subject ? norm(subject[1]) : "";
    if (key.length >= 3 && !months.includes(key) && context.categories.some(label => norm(label) !== key && distance(key, norm(label), 1) <= 1)) return null;
  }
  if (!isDate(context.today) || dateOutOfRange(context.today)) return unsupported("Refresh the current date before starting a preview.");
  // Mask by original offsets, so corrections never replace a date or remove another clause.
  const erase = (start: number, length: number) => { rest = rest.slice(0, start) + " ".repeat(length) + rest.slice(start + length); };
  const take = (pattern: RegExp) => { const m = pattern.exec(rest); if (m) erase(m.index, m[0].length); return m; };
  const takeOutsideNames = (pattern: RegExp) => {
    const search = new RegExp(pattern.source, pattern.flags + "g");
    let match: RegExpExecArray | null;
    while ((match = search.exec(rest))) {
      if (outsideName(match.index)) { erase(match.index, match[0].length); return match; }
    }
    return null;
  };
  if (discovery) erase(0, rest.length);
  else erase(rest.length - rest.trimStart().length, (goal ?? namedDiscovery)![0].length);
  if (categoryDiscovery) take(/\s+to save money[.?!]?\s*$/iu);
  const draft: CutPreviewDraft = { sourceText: text, target: { kind: null, amount: null }, categories: [], excludedCategories: [], horizon: null, partialMonth: null, missing: [] };
  const validReduction = (reduction: CutPreviewCategory["maximumReduction"]) => validateScenarioIntent({ version: 1, category: "__terms__", reduction, cadence: "monthly", horizon: { kind: "prospective", from: context.today, to: context.today }, partialMonth: "prorate" }, { asOf: context.today, categories: ["__terms__"] });
  const amount = take(new RegExp(`^\\s*${cash}`, "iu"));
  if (amount) {
    draft.target.amount = (amount[1] ?? amount[2]).replace(/,/g, "");
    const checked = validReduction({ kind: "money", amount: draft.target.amount });
    if (!checked.ok) return unsupported(checked.reason);
  } else if (/^\s*[$\d+-]/u.test(rest)) return unsupported("Enter a fixed dollar savings target, with valid grouping and at most two decimals.");

  const names = [...context.categories].sort((a, b) => b.length - a.length);
  const counts = new Map<string, number>();
  for (const label of names) counts.set(norm(label), (counts.get(norm(label)) ?? 0) + 1);
  const constrained = new Map<string, CutPreviewCategory>();
  // Compile the expensive per-label grammar only for a clause that can actually occur.
  // This also avoids a cold first-question main-thread stall on an unused roster.
  const constraintText = norm(rest).toUpperCase().toLowerCase();
  const constraintNames = /\bwith\s+/iu.test(rest) ? names.filter(label => {
    // Plain printable ASCII labels can use a conservative text prefilter. Upper/lower folding also admits
    // Unicode equivalents such as long-s; false positives still face the full grammar.
    // Non-ASCII labels use a short Unicode-aware prefix check to preserve exact semantics.
    if (label.trim() !== label || /[^\x20-\x7E]/u.test(label)) return new RegExp(`\\bwith\\s+${entityPattern(label)}\\s+floor\\b`, "iu").test(rest);
    const key = norm(label);
    return constraintText.includes(`with ${key} floor`) || constraintText.includes(`with "${key}" floor`);
  }) : [];
  for (const label of constraintNames) {
    if (!norm(label)) continue;
    const pattern = new RegExp(`\\bwith\\s+${entityPattern(label)}\\s+floor\\s+${cash}\\s+and\\s+maximum cut\\s+(?:${cash}|(${number})\\s*(?:%|percent)(?![\\p{L}\\p{N}.]))`, "iu");
    let m: RegExpExecArray | null;
    while ((m = take(pattern))) {
      if (counts.get(norm(label)) !== 1 || constrained.has(label)) return unsupported(`Choose one set of constraints for the exact category "${label}".`);
      const monthlyFloor = (m[1] ?? m[2]).replace(/,/g, "");
      const maximumReduction: CutPreviewCategory["maximumReduction"] = { kind: m[5] ? "percent" : "money", amount: (m[3] ?? m[4] ?? m[5]).replace(/,/g, "") };
      for (const reduction of [{ kind: "money" as const, amount: monthlyFloor }, maximumReduction]) { const checked = validReduction(reduction); if (!checked.ok) return unsupported(checked.reason); }
      constrained.set(label, { category: label, monthlyFloor, maximumReduction });
    }
  }
  // Natural-language limits remain incomplete terms. No missing floor or cap is filled in.
  const sharedCap = takeOutsideNames(new RegExp(`(?:,?\\s*(?:and\\s+)?(?:i|we)\\s+can\\s+cut\\s+up\\s+to|,?\\s*up\\s+to)\\s+(half|${number}\\s*(?:%|percent))(?![\\p{L}\\p{N}]|\\.\\d)(?:\\s+of\\s+each)?`, "iu"));
  let capAmount: string | null = null;
  if (sharedCap) {
    capAmount = /^half$/iu.test(sharedCap[1]) ? "50" : sharedCap[1].replace(/\s*(?:%|percent)$/iu, "").replace(/,/g, "");
    const checked = validReduction({ kind: "percent", amount: capAmount });
    if (!checked.ok) return unsupported(checked.reason);
  }
  const sharedFloor = takeOutsideNames(new RegExp(`\\bbut\\s+keep\\s+at\\s+least\\s+${cash}\\s+(?:a|per|each|every)\\s+month\\b`, "iu"));
  const floorAmount = sharedFloor ? (sharedFloor[1] ?? sharedFloor[2]).replace(/,/g, "") : null;
  if (floorAmount !== null) {
    const checked = validReduction({ kind: "money", amount: floorAmount });
    if (!checked.ok) return unsupported(checked.reason);
  }
  const flexible = sharedCap ? takeOutsideNames(/\bare\s+flexible\b/iu) : null;
  const unknown: { raw: string; start: number; end: number }[] = [];
  let listProblem: string | null = null;
  const readList = (prefix: RegExp, output: string[]) => {
    const lead = take(prefix); if (!lead) return;
    let position = lead.index + lead[0].length;
    while (true) {
      position += /^\s*/u.exec(rest.slice(position))![0].length;
      const tail = rest.slice(position);
      const exact = names.map(label => ({ label, match: norm(label) ? new RegExp(`^${entityPattern(label)}`, "iu").exec(tail) : null })).find(item => item.match);
      let length: number;
      if (exact?.match) {
        if (counts.get(norm(exact.label)) !== 1 || output.includes(exact.label)) { listProblem = `Choose each unambiguous category once: "${exact.label}".`; return; }
        output.push(exact.label); length = exact.match[0].length;
      } else {
        const end = /\s+(?:and|from|starting|in|on|at|for|monthly|total|weekly|daily|once|with|except|excluding|without|but|using|unless|prorated|prorate)\b|[.,;?!]|$/iu.exec(tail)!.index;
        const raw = tail.slice(0, end).trim();
        if (!raw || /\b(?:budget|budgets|apply|invest|not|never|fewest|least|save|saving|spend|spent|cut|reduce|if)\b/iu.test(raw)) { listProblem = `I couldn't use the category clause "${tail.trim()}". Name exact flexible spending categories without changing budget limits or dropping conditions.`; return; }
        if (/^(?:weekends?|weekdays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)$/iu.test(raw)) { listProblem = `The condition "${raw}" is not a supported category exclusion. Choose exact categories and a monthly schedule.`; return; }
        unknown.push({ raw: raw.replace(/^"|"$/g, ""), start: position, end: position + end }); length = end;
      }
      erase(position, length); position += length;
      const separator = /^\s*(?:,|and\b)\s*/iu.exec(rest.slice(position));
      if (!separator) break;
      erase(position, separator[0].length); position += separator[0].length;
      if (separator[0].includes(",")) {
        const following = rest.slice(position);
        // A comma may terminate a list; preserve every following schedule or scope clause.
        if (/^(?:[.?!]?\s*$|(?:from|starting|in|on|at|for|monthly|total|with|except|excluding|without|but|using|unless|prorat)\b)/iu.test(following)) break;
        const oxford = /^and\b\s*/iu.exec(following);
        if (oxford) { erase(position, oxford[0].length); position += oxford[0].length; }
      }
    }
  };
  const selected: string[] = [];
  if (categoryDiscovery) readList(/^\s*/u, selected);
  else {
    readList(/\bacross\s+/iu, selected);
    // An unquoted calendar endpoint is never a category, even when the roster contains November.
    const from = /\bfrom\s+/iu.exec(rest);
    if (from && !/^(?:\d{4}-\d{2}-\d{2}\b|today\b|next\s+month\b|(?:january|february|march|april|may|june|july|august|september|october|november|december)\b)/iu.test(rest.slice(from.index + from[0].length))) readList(/\bfrom\s+/iu, selected);
    if (flexible) readList(/;\s*/u, selected);
  }
  readList(/\b(?:(?:but\s+)?(?:do not|don't|dont|never)\s+(?:cut|reduce)|except|excluding|without reducing)\s+/iu, draft.excludedCategories);
  if (listProblem) return unsupported(listProblem);
  for (const label of constrained.keys()) if (!selected.includes(label)) selected.push(label);
  if (selected.length + draft.excludedCategories.length + unknown.length > 20) return unsupported("Choose at most 20 category selections and exclusions in one question.");
  if (selected.some(label => draft.excludedCategories.includes(label))) return unsupported("A category cannot be both selected for cuts and excluded. Choose which you mean.");
  const namedCount = selected.length + unknown.length;
  if ((sharedCap || sharedFloor) && (!namedCount || constrained.size || (namedCount > 1 && (sharedFloor || !/of\s+each\s*$/iu.test(sharedCap![0]))))) return unsupported("State a separate floor and maximum cut for each category, or say that a percentage cap applies to each.");
  draft.categories = selected.map(category => constrained.get(category) ?? { category, monthlyFloor: floorAmount, maximumReduction: capAmount === null ? null : { kind: "percent", amount: capAmount } });
  if (/\bbudgets?\b/iu.test(rest)) return unsupported("This preview uses actual spending, not budget headroom or a change to budget limits.");
  const scope = /\bat\s+[\p{L}][\p{L}\p{N}' -]*|\bon\s+(?:card|account)\s+[\p{L}\p{N}' -]+|\bfor\s+(?!(?:the|this|all|full|whole|six|a)\b)[\p{L}][\p{L}' -]*/iu.exec(rest)
    ?? [...context.accounts.map(a => a.name), ...(context.familyMembers?.map(m => m.name) ?? context.members ?? [])].map(name => new RegExp(`\\b(?:on|for)\\s+${entityPattern(name)}`, "iu").exec(rest)).find(Boolean);
  if (scope) return unsupported(`The scope "${scope[0].trim()}" is not supported. Choose flexible categories across the household.`);
  const forbidden = /\b(?:weekly|daily|weeks?|once|one-time|yesterday|last year|last month|ago|invest|investment|retire|retirement|apply|update|delete|transfer|not|never|unless|fewest|fewer|minimum number)\b/iu.exec(rest);
  if (forbidden) return unsupported(`The condition "${rest.trim().replace(/\s+/g, " ")}" is not supported by this monthly spread preview. Choose monthly cuts with explicit dates and permitted categories.`);
  const monthly = take(/\b(?:monthly|(?:a|per|each|every) month)\b/iu);
  const total = take(/\b(?:in total|total|altogether|over the (?:whole )?period)\b/iu);
  if (monthly && total) return unsupported("Choose a monthly target or a total over the selected dates, separately.");
  draft.target.kind = monthly ? "monthly" : total ? "total" : null;
  const scheduleText = rest.trim();
  const material = scheduleText.replace(/\b(?:prorated by calendar days|prorate by calendar days)\b/giu, " ");
  if (/\b(?:if|save|savings|spend|spent|spending|less|cut|reduce|reduced|would|could|by)\b/iu.test(material) || /\b(?:for|from|through|to|until|in|on|starting)\s*[.?!]?$/iu.test(material)) {
    return unsupported(`I couldn't account for the condition "${scheduleText.replace(/\s+/g, " ")}". Keep the full condition or ask a supported monthly target question.`);
  }
  // M3 owns audited date semantics. A local synthetic request checks schedule clauses only;
  // placeholders never leave this function and never authorize financial reads.
  const monthNames = months.join("|");
  const endpoints = new RegExp(`\\b(?:from\\s+)?(${monthNames})\\s+(\\d{4})\\s+(?:through|to|until)\\s+(${monthNames})\\s+(\\d{4})\\b`, "iu");
  const scheduleInput = rest.trim().replace(endpoints, (_whole, first: string, firstYear: string, last: string, lastYear: string) => {
    const a = months.indexOf(first.toLowerCase()) + 1, b = months.indexOf(last.toLowerCase()) + 1;
    return `from ${isoDate(Number(firstYear), a, 1)} through ${isoDate(Number(lastYear), b, daysInMonth(Number(lastYear), b))}`;
  });
  const schedule = parseSpendingScenario(`Cut "__m4_schedule__" by $0 monthly ${scheduleInput}`, { ...context, categories: ["__m4_schedule__"] });
  if (schedule?.kind !== "scenario") return unsupported(schedule?.kind === "scenario-unsupported"
    ? schedule.reason.replace(/Use one category, a monthly or one-time amount, and explicit dates\./gi, "Use a savings target, selected categories and explicit monthly dates.")
    : "Choose an explicit monthly schedule for the savings target.");
  draft.horizon = schedule.draft.horizon;
  draft.partialMonth = schedule.draft.partialMonth === "none" ? null : schedule.draft.partialMonth;
  if (!draft.horizon) {
    const yearCue = /\b(?:(?:for\s+)?the rest of\s+)?this year\b/iu.exec(rest);
    if (yearCue) (draft.scheduleHints ??= []).push({ kind: "year-choice", year: Number(context.today.slice(0, 4)),
      choices: /rest of/iu.test(yearCue[0]) ? ["remaining-year"] : ["remaining-year", "full-year-hypothetical"],
      text: text.slice(yearCue.index, yearCue.index + yearCue[0].length), start: yearCue.index, end: yearCue.index + yearCue[0].length });
  }
  for (const hint of schedule.draft.scheduleHints ?? []) {
    if ((hint.date && (dateOutOfRange(hint.date) || hint.date < context.today)) || (hint.year !== undefined && (hint.year < 1900 || hint.year > 2100))) return unsupported("Choose prospective dates between 1900 and 2100, or explicitly choose the current full-year hypothetical.");
    const match = new RegExp(escape(hint.text).replace(/\s+/g, "\\s+"), "iu").exec(rest);
    if (match) (draft.scheduleHints ??= []).push({ ...hint, text: text.slice(match.index, match.index + match[0].length), start: match.index, end: match.index + match[0].length });
  }
  // All unknown category spans are resolved only after the remaining material passed.
  if (unknown.length) {
    const item = unknown[0], key = norm(item.raw);
    const candidates = key.length < 3 ? [] : [...new Set(names)].filter(label => counts.get(norm(label)) === 1 && distance(key, norm(label), 1) <= 1).sort().slice(0, 3);
    return { kind: "cut-preview-clarify", clarification: { status: "clarify", reason: candidates.length ? `Choose the category you mean by "${item.raw}".` : `No close category matches "${item.raw}". Use an exact category name.`, choices: candidates, replacements: candidates.map(label => text.slice(0, item.start) + `"${label}"` + text.slice(item.end)) } };
  }
  if (!discovery && !draft.target.amount && !draft.categories.length && !draft.excludedCategories.length && !draft.horizon && !draft.scheduleHints?.length) return unsupported("State a dollar target, such as: Where can I cut back to save $200 a month?");
  if (draft.target.amount === null) draft.missing.push("target");
  if (draft.target.kind === null) draft.missing.push("target-basis");
  if (!draft.categories.length) draft.missing.push("categories");
  if (draft.categories.some(row => row.monthlyFloor === null || row.maximumReduction === null)) draft.missing.push("constraints");
  if (!draft.horizon) draft.missing.push("horizon");
  if (!draft.partialMonth) draft.missing.push("partial-month");
  return { kind: "cut-preview", draft };
};
