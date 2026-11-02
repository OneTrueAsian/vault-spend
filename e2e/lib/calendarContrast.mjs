// A repeatable numerical contrast measurement for the app-drawn calendars, run in the compiled WebView.
//
// Why not Axe's contrast rule: the calendar sits on a translucent, blurred surface, and Axe cannot work out
// the colour that is really behind the text, so it reports the check as "incomplete". This measures it:
//   1. In one pointer/focus state, record each text element's computed colour, its alpha and the opacity of
//      its ancestors, and the points to sample (the centre and four points around it, where the text is).
//   2. Hide only the text ink in the disposable document (`color: transparent`), take a screenshot, and put the
//      document back. What is left is the real composited background: the frosted surface, any hover or
//      selected fill, the theme's gradient behind it.
//   3. Decode the PNG here, blend each foreground over each sampled background pixel, and compute the WCAG
//      relative-luminance ratio. The worst of an element's sample points is its ratio.
// Text must reach 4.5:1 (the calendar's text is all below the large-text size); the glyphs on the navigation
// buttons are graphics and need 3:1. Disabled controls are measured and reported but are not held to a
// threshold (WCAG exempts inactive components). Outline, today-ring and focus-ring colours are not measured.
//
// A sample is evidence for that theme, accent, state and backdrop only. It is not a proof across every backdrop,
// browser, zoom level or forced-colours setting.

import zlib from "node:zlib";

export const TEXT_MINIMUM = 4.5;
export const GRAPHIC_MINIMUM = 3;

/** Decodes an 8-bit, non-interlaced greyscale, RGB or RGBA PNG to RGBA bytes. */
export function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, i) => buffer[i] === byte)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const parts = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colourType = body[9];
      if (body[8] !== 8) throw new Error(`unsupported PNG bit depth ${body[8]}`);
      if (body[12] !== 0) throw new Error("interlaced PNG is not supported");
    } else if (type === "IDAT") parts.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 6: 4 }[colourType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colourType}`);
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[y * stride + x - channels] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? out[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      out[y * stride + x] = value & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (channels === 1) rgba.set([out[i], out[i], out[i], 255], i * 4);
    else rgba.set([out[i * channels], out[i * channels + 1], out[i * channels + 2], channels === 4 ? out[i * channels + 3] : 255], i * 4);
  }
  return { width, height, data: rgba };
}

export function pixelAt(image, x, y) {
  const cx = Math.min(image.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(image.height - 1, Math.max(0, Math.round(y)));
  const i = (cy * image.width + cx) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

const channel = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The colour a foreground of `alpha` coverage shows on `background`. */
export function blend(foreground, alpha, background) {
  return foreground.map((v, i) => v * alpha + background[i] * (1 - alpha));
}

/**
 * One measured element: its foreground (rgb plus total alpha) against the background pixels sampled at its
 * points, scaled from CSS pixels to the screenshot. The element's ratio is the worst sample.
 */
export function measureElement(image, viewport, element) {
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const samples = element.points.map(([x, y]) => {
    const background = pixelAt(image, x * scaleX, y * scaleY);
    const shown = blend(element.rgb, element.alpha, background);
    return { background, ratio: contrastRatio(shown, background) };
  });
  const worst = samples.reduce((a, s) => (s.ratio < a.ratio ? s : a));
  const threshold = element.exempt ? null : element.graphic ? GRAPHIC_MINIMUM : TEXT_MINIMUM;
  return { ...element.describe, ratio: worst.ratio, background: worst.background, foreground: element.rgb, alpha: element.alpha, threshold, passes: threshold === null ? null : worst.ratio >= threshold };
}

const CALENDAR_ROOT = '.calendar-popover[role="dialog"]';

/** Runs in the page: what to measure in the state the page is in now. `categories` is [name, selector, graphic?]. */
function collectInPage(categories, rootSelector) {
  const popup = document.querySelector(rootSelector);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const toRgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  };
  const pr = popup.getBoundingClientRect();
  const clip = { top: Math.max(pr.top + popup.clientTop, 0), bottom: Math.min(pr.top + popup.clientTop + popup.clientHeight, innerHeight) };
  // What is visible of an element: the popup's own edge, and the edge of any scrolling box between it and the popup.
  const visibleBand = (el) => {
    let top = clip.top;
    let bottom = clip.bottom;
    for (let p = el.parentElement; p && p !== popup; p = p.parentElement) {
      if (getComputedStyle(p).overflowY === "visible") continue;
      const r = p.getBoundingClientRect();
      top = Math.max(top, r.top + p.clientTop);
      bottom = Math.min(bottom, r.top + p.clientTop + p.clientHeight);
    }
    return { top, bottom };
  };
  const found = [];
  const absent = [];
  for (const [name, selector, graphic] of categories) {
    const el = popup.querySelector(selector);
    if (!el) {
      absent.push(name);
      continue;
    }
    const r = el.getBoundingClientRect();
    const band = visibleBand(el);
    if (r.top < band.top - 0.5 || r.bottom > band.bottom + 0.5) {
      absent.push(`${name} (scrolled out of view)`);
      continue;
    }
    const css = getComputedStyle(el);
    const [cr, cg, cb, ca] = toRgba(css.color);
    let opacity = 1;
    for (let p = el; p; p = p.parentElement) {
      opacity *= Number(getComputedStyle(p).opacity);
      if (p === popup) break;
    }
    // Sample where the text is: the centre and four points a few pixels either side of it (further apart along a
    // wide label). Not the box's corners: a rounded cell's border, ring or glow runs through them and is not behind the text.
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = Math.min(Math.max(r.width / 4, 5), 24);
    const dy = Math.min(r.height / 4, 5);
    const points = [[cx, cy], [cx - dx, cy], [cx + dx, cy], [cx, cy - dy], [cx, cy + dy]];
    found.push({
      describe: { name, text: el.textContent.trim().slice(0, 20) || el.value || "", hover: el.matches(":hover"), focus: el.matches(":focus-visible") },
      rgb: [cr, cg, cb],
      alpha: (ca / 255) * opacity,
      graphic: Boolean(graphic),
      exempt: el.disabled === true,
      points,
    });
  }
  return { found, absent, viewport: { width: innerWidth, height: innerHeight } };
}

const hideInk = (root) => `${root},${root} *{color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important}`;

/**
 * Measures the categories in the state the page is in now. Returns `{ measured, absent }`. The screenshot with
 * ink hidden is returned for the evidence folder.
 */
export async function measureState(b, categories, rootSelector = CALENDAR_ROOT) {
  const { found, absent, viewport } = await b.execute(collectInPage, categories, rootSelector);
  await b.execute((css) => {
    const style = document.createElement("style");
    style.id = "contrast-hide-ink";
    style.textContent = css;
    document.head.append(style);
  }, hideInk(rootSelector));
  let png;
  try {
    png = Buffer.from(await b.takeScreenshot(), "base64");
  } finally {
    await b.execute(() => document.getElementById("contrast-hide-ink")?.remove());
  }
  const image = decodePng(png);
  return { measured: found.map((element) => measureElement(image, viewport, element)), absent, background: png };
}

/** Text categories in the date and month calendars: [name, selector, graphic?]. */
export const REST_CATEGORIES = {
  date: [
    ["weekday heading", ".calendar-grid th"],
    ["month and year heading", ".calendar-jump"],
    ["previous and next buttons", ".calendar-nav:not(:disabled)", true],
    ["ordinary day", ".calendar-day:not(.is-selected):not(.is-today):not(.is-outside):not(:disabled)"],
    ["today", ".calendar-day.is-today:not(.is-selected)"],
    ["selected day", ".calendar-day.is-selected"],
    ["adjacent-month day", ".calendar-day.is-outside:not(:disabled)"],
    ["unavailable day", ".calendar-day:disabled"],
    ["action", ".calendar-action:not(:disabled)"],
  ],
  month: [
    ["year heading", ".calendar-year, .calendar-jump"],
    ["previous and next buttons", ".calendar-nav:not(:disabled)", true],
    ["ordinary month", ".calendar-month:not(.is-selected):not(.is-today):not(:disabled)"],
    ["this month", ".calendar-month.is-today:not(.is-selected)"],
    ["selected month", ".calendar-month.is-selected"],
    ["unavailable month", ".calendar-month:disabled"],
    ["action", ".calendar-action:not(:disabled)"],
  ],
};

/**
 * Pointer and focus states, each measured in its own screenshot. `target` picks the element the state is
 * applied to; `measure` lists what is read in that state (the element itself, plus anything else the state
 * leaves unchanged is not re-read).
 */
export function stateSteps(kind) {
  const cell = kind === "date" ? ".calendar-day" : ".calendar-month";
  const ordinary = kind === "date" ? `${cell}:not(.is-selected):not(.is-today):not(.is-outside):not(:disabled)` : `${cell}:not(.is-selected):not(.is-today):not(:disabled)`;
  return [
    { name: "hover ordinary", hover: ordinary, measure: [["ordinary, hovered", ordinary]] },
    { name: "hover selected", hover: `${cell}.is-selected`, measure: [["selected, hovered", `${cell}.is-selected`]] },
    { name: "hover action", hover: ".calendar-action:not(:disabled)", measure: [["action, hovered", ".calendar-action:not(:disabled)"]] },
    ...(kind === "date" ? [{ name: "hover heading", hover: ".calendar-jump:not(:disabled)", measure: [["heading, hovered", ".calendar-jump:not(:disabled)"]] }] : []),
    { name: "keyboard focus ordinary", focus: ordinary, measure: [["ordinary, keyboard focus", ordinary]] },
    { name: "keyboard focus action", focus: ".calendar-action:not(:disabled)", measure: [["action, keyboard focus", ".calendar-action:not(:disabled)"]] },
  ];
}

/** Steps that depend on the accent colour (the selected fill and the focus colour): the other accents run only these. */
export const ACCENT_SENSITIVE = new Set(["hover selected", "keyboard focus ordinary", "keyboard focus action"]);

/**
 * Puts the open calendar into one pointer/focus state. The pointer is parked away from the calendar first.
 * Returns whether the wanted state is actually active on the target, which the measurement records.
 */
export async function enterState(b, step) {
  await b.performActions([{ type: "pointer", id: "contrast-mouse", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", duration: 0, origin: "viewport", x: 1, y: 1 }] }]);
  await b.releaseActions();
  if (step.hover) {
    const at = await b.execute((selector) => {
      const el = document.querySelector(`.calendar-popover ${selector}`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, step.hover);
    if (!at) return false;
    await b.performActions([{ type: "pointer", id: "contrast-mouse", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", duration: 0, origin: "viewport", x: Math.round(at.x), y: Math.round(at.y) }] }]);
    await b.releaseActions();
    return b.execute((selector) => document.querySelector(`.calendar-popover ${selector}`).matches(":hover"), step.hover);
  }
  // A key press first, so a script focus counts as keyboard focus (:focus-visible).
  await b.keys("Shift");
  return b.execute((selector) => {
    const el = document.querySelector(`.calendar-popover ${selector}`);
    if (!el) return false;
    el.focus();
    return el.matches(":focus-visible");
  }, step.focus);
}
