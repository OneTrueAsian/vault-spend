// Browser hit-testing and real pointer clicks for the app-drawn calendars.
//
// Axe's `target-size` rule decides whether a target is "obscured" from a stacking order it works out itself. The
// calendar lives in the browser's top layer (a popover), which that calculation does not know about, so Axe
// reports the controls of the dialog *underneath* the calendar as covering its days. The matrix therefore runs
// `target-size` separately and accepts only that one kind of finding (see `splitTargetSizeFindings`), and
// replaces it with what this file does in the real WebView:
//   - `probeHits`: for every enabled control in the calendar that is fully visible, asks the browser which
//     element is at its centre and four inset corners (`elementFromPoint`) and requires the control itself.
//     Controls the popup has scrolled out of view, or that its edge clips, are counted as clipped and are not
//     tested for hits; a clipped control is acceptable only when the popup can scroll to it.
//   - `pointerClick` / `clickAtCentre`: real mouse movement, press and release at viewport coordinates, with a
//     capture listener recording what actually received the click.
//   - `coverFirst`: a negative control that puts an element over a control and shows `probeHits` reports it.
//
// None of this is exhaustive across zoom levels, platforms or future layouts; it is evidence for the inspected
// themes, sizes and scroll positions.

const MIN_TARGET = 24;

/** Runs in the page. Returns the hit-test report for the open calendar. */
function probeInPage(minTarget) {
  const popup = document.querySelector('.calendar-popover[role="dialog"]');
  if (!popup) return null;
  const pr = popup.getBoundingClientRect();
  const clip = {
    left: Math.max(pr.left + popup.clientLeft, 0),
    top: Math.max(pr.top + popup.clientTop, 0),
    right: Math.min(pr.left + popup.clientLeft + popup.clientWidth, innerWidth),
    bottom: Math.min(pr.top + popup.clientTop + popup.clientHeight, innerHeight),
  };
  const name = (el) => el.getAttribute("data-date") || el.getAttribute("data-month") || el.getAttribute("aria-label") || el.textContent.trim() || el.className;
  const controls = [...popup.querySelectorAll("button, input")].filter((el) => !el.disabled);
  const visible = [];
  const clipped = [];
  const misses = [];
  const small = [];
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.width < minTarget || r.height < minTarget) small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    const inside = r.left >= clip.left - 0.5 && r.right <= clip.right + 0.5 && r.top >= clip.top - 0.5 && r.bottom <= clip.bottom + 0.5;
    if (!inside) {
      clipped.push(name(el));
      continue;
    }
    visible.push(name(el));
    const inset = Math.min(3, r.width / 4, r.height / 4);
    const points = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + inset, r.top + inset], [r.right - inset, r.top + inset], [r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset]];
    for (const [x, y] of points) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) misses.push({ control: name(el), x: Math.round(x), y: Math.round(y), hit: hit ? (hit.getAttribute("aria-label") || hit.className || hit.tagName).toString().slice(0, 60) : null });
    }
  }
  const trigger = popup.closest(".date-field")?.querySelector(".date-field-trigger");
  let triggerReport = null;
  if (trigger) {
    const t = trigger.getBoundingClientRect();
    const hit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
    triggerReport = { width: t.width, height: t.height, centreHit: Boolean(hit && trigger.contains(hit)) };
  }
  return {
    popoverOpen: popup.matches(":popover-open"),
    scroll: { top: popup.scrollTop, height: popup.scrollHeight, client: popup.clientHeight },
    visible,
    clipped,
    misses,
    small,
    trigger: triggerReport,
  };
}

export async function probeHits(b) {
  return b.execute(probeInPage, MIN_TARGET);
}

/** Scrolls the open calendar to its top or bottom and says whether it can scroll at all. */
export async function scrollPopup(b, where) {
  return b.execute((where) => {
    const popup = document.querySelector(".calendar-popover");
    const scrollable = popup.scrollHeight > popup.clientHeight + 1;
    popup.scrollTop = where === "bottom" ? popup.scrollHeight : 0;
    return { scrollable, top: popup.scrollTop };
  }, where);
}

/** Real mouse move, press and release at viewport coordinates; resolves with what received the click. */
export async function pointerClick(b, x, y) {
  await b.execute(() => {
    window.__pointerClickLog = [];
    document.addEventListener(
      "click",
      (e) => window.__pointerClickLog.push({ tag: e.target.tagName, date: e.target.closest?.("[data-date]")?.getAttribute("data-date") ?? null, month: e.target.closest?.("[data-month]")?.getAttribute("data-month") ?? null, label: e.target.closest?.("button, input")?.getAttribute("aria-label") ?? null, text: e.target.closest?.("button")?.textContent.trim() ?? null, inCalendar: Boolean(e.target.closest?.(".calendar-popover")) }),
      { capture: true, once: true },
    );
  });
  await b.performActions([
    { type: "pointer", id: "calendar-mouse", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", duration: 0, origin: "viewport", x: Math.round(x), y: Math.round(y) }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 }] },
  ]);
  await b.releaseActions();
  return (await b.execute(() => window.__pointerClickLog))[0] ?? null;
}

/** Centre of an element (found by a CSS selector) in viewport coordinates. */
export async function centreOf(b, selector) {
  return b.execute((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

export async function clickAtCentre(b, selector) {
  const at = await centreOf(b, selector);
  if (!at) throw new Error(`nothing to click for ${selector}`);
  return pointerClick(b, at.x, at.y);
}

/** The last enabled action in the calendar (Today / This month / Clear) that is fully visible, as a selector-free token. */
export async function lastVisibleAction(b) {
  return b.execute(() => {
    const popup = document.querySelector(".calendar-popover");
    const pr = popup.getBoundingClientRect();
    const actions = [...popup.querySelectorAll(".calendar-action:not(:disabled)")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= pr.top + popup.clientTop - 0.5 && r.bottom <= pr.top + popup.clientTop + popup.clientHeight + 0.5 && r.bottom <= innerHeight + 0.5;
    });
    const el = actions[actions.length - 1];
    if (!el) return null;
    el.setAttribute("data-probe-action", "1");
    const r = el.getBoundingClientRect();
    return { text: el.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
}

/** Negative control: lays a transparent element over the first enabled day or month, probes, removes it. */
export async function coverFirst(b) {
  await b.execute(() => {
    const popup = document.querySelector(".calendar-popover");
    const cell = popup.querySelector(".calendar-day:not(:disabled), .calendar-month:not(:disabled)");
    const r = cell.getBoundingClientRect();
    const cover = document.createElement("div");
    cover.id = "hit-negative-control";
    // Absolute inside the popup: a backdrop-filter makes the popup the containing block of fixed children.
    const pr = popup.getBoundingClientRect();
    cover.style.cssText = `position:absolute;left:${r.left - pr.left - popup.clientLeft + popup.scrollLeft}px;top:${r.top - pr.top - popup.clientTop + popup.scrollTop}px;width:${r.width}px;height:${r.height}px;background:transparent;z-index:99`;
    popup.append(cover);
  });
  try {
    return await probeHits(b);
  } finally {
    await b.execute(() => document.getElementById("hit-negative-control")?.remove());
  }
}

/**
 * Axe's target-size findings split into the one kind this suite accepts and everything else. Accepted: every
 * reason is either "partially obscured" or "insufficient space to its closest neighbors" (the second is the
 * same obscuring seen as lost spacing), at least one of the related nodes is OUTSIDE the calendar (the dialog
 * beneath it, which the top layer puts behind), and the related nodes inside the calendar are only sibling
 * targets named as neighbours. Anything else (too small, a different rule's reason, or no outside cause)
 * stays a failure. The matrix still requires the browser to confirm that nothing covers the control.
 * @param nodes `{ node, reasons: string[], related: { inside: boolean, html: string }[] }`
 */
export function splitTargetSizeFindings(nodes) {
  const accepted = [];
  const failing = [];
  for (const n of nodes) {
    const explained = n.reasons.length > 0 && n.reasons.every((r) => /obscured|closest neighbors/i.test(r)) && n.reasons.some((r) => /obscured/i.test(r));
    const outsideCause = n.related.some((r) => !r.inside);
    (explained && outsideCause ? accepted : failing).push(n);
  }
  return { accepted, failing };
}

/** Axe's target-size rule on the open calendar, nodes described for `splitTargetSizeFindings`. */
export async function runTargetSizeAxe(b) {
  return b.executeAsync((done) => {
    const popup = document.querySelector(".calendar-popover");
    window.axe
      .run(popup, { runOnly: { type: "rule", values: ["target-size"] } })
      .then((r) => {
        const nodes = r.violations.flatMap((v) =>
          v.nodes.map((n) => {
            const checks = n.any.concat(n.all, n.none);
            return {
              node: n.target.join(" "),
              reasons: checks.map((c) => c.message),
              related: checks.flatMap((c) => c.relatedNodes ?? []).map((rel) => {
                const el = document.querySelector(rel.target[0]);
                return { inside: Boolean(el && popup.contains(el)), html: rel.html.slice(0, 120) };
              }),
            };
          }),
        );
        done({ nodes });
      })
      .catch((e) => done({ error: String(e) }));
  });
}
