// npm run e2e:review: a local vision model (Ollama) reviews kept screenshots so an agent reads a short summary instead of every image.
// Ollama is replaced by a recorded stand-in here; the request and reply shapes are Ollama's /api/chat.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelUnavailableError, ensureOllama, findScreens, promptFor, reviewScreens } from "./screenReview.mjs";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-review-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const png = (rel) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(rel)); return f; };
// The model answers with a list of issues, each with where, what it saw, a problem type and whether it is sure; the verdict is worked out from that.
const issue = (where, seen, sure = true, type = 2) => ({ where, seen, type, sure });
const reply = (issues = []) => ({ ok: true, status: 200, json: async () => ({ model: "qwen3.6:35b", message: { role: "assistant", content: JSON.stringify({ issues }) }, done: true, prompt_eval_count: 1300, eval_count: 40 }) });
const stub = (...replies) => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); const r = replies[calls.length - 1]; if (r instanceof Error) throw r; return r; };
  return { fetchImpl, calls };
};
const quiet = () => {};

describe("finding screenshots", () => {
  it("returns nested PNGs sorted and skips other files", () => {
    png("feature415/b.png"); png("feature414/a.png");
    fs.writeFileSync(path.join(dir, "feature415", "notes.txt"), "x");
    fs.writeFileSync(path.join(dir, "verdicts.json"), "[]");
    expect(findScreens(dir).map((f) => path.relative(dir, f).replace(/\\/g, "/"))).toEqual(["feature414/a.png", "feature415/b.png"]);
  });
});

describe("the prompt", () => {
  it("adds theme and width from the file name", () => {
    const text = promptFor(path.join(dir, "layout-Budget-dark-720.png"));
    expect(text).toContain("dark theme");
    expect(text).toContain("720px");
  });
  it("leaves theme and width out when the name does not say", () => {
    const text = promptFor(path.join(dir, "shot.png"));
    expect(text).not.toMatch(/light theme|dark theme/);
    expect(text).not.toMatch(/\d+px/);
    expect(text).not.toMatch(/style/);
  });
  // Retro's grey bevelled borders and Futuristic's glow were the biggest source of false "border" and "theme" flags in the 19 Nov audit.
  it("adds the style from the file name", () => {
    expect(promptFor(path.join(dir, "accounts-retro-dark-720.png"))).toContain("the Retro style");
    expect(promptFor(path.join(dir, "futuristic-light-1280x800-blocked.png"))).toContain("the Futuristic style");
    expect(promptFor(path.join(dir, "household-budget-transparent-dark-720.png"))).toContain("the Default style");
  });
  it("reads the width from names like 1280x800", () => {
    expect(promptFor(path.join(dir, "futuristic-dark-1280x800-blocked.png"))).toContain("1280px");
  });
});

describe("what the model is asked", () => {
  it("describes the deliberate design and asks for six kinds of problem, each with a quote and whether it is sure", async () => {
    png("s/a.png");
    const { fetchImpl, calls } = stub(reply());
    await reviewScreens({ dir, fetchImpl, log: quiet });
    const system = calls[0].body.messages[0].content;
    expect(system).toMatch(/dialog is open, the page behind it is dimmed/);
    expect(system).toMatch(/Retro style has grey panels with double, bevelled borders/);
    expect(system).toMatch(/Raw technical text/);
    expect(system).not.toMatch(/Panel by panel/);
    expect(calls[0].body.format.properties.issues.items.required).toEqual(["where", "seen", "type", "sure"]);
  });
});

describe("the verdict", () => {
  it("is pass with no issues, fail when any issue is sure, unsure when none are", async () => {
    png("s/a.png"); png("s/b.png"); png("s/c.png");
    const { fetchImpl } = stub(reply(), reply([issue("Cash card", "$NaN"), issue("Cash card", "maybe cut", false)]), reply([issue("Budget table", "Utilit", false)]));
    const { verdicts } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(verdicts.map((v) => v.verdict)).toEqual(["pass", "fail", "unsure"]);
  });
  it("writes each issue as where, the quoted text, and 'not sure' when the model is not sure", async () => {
    png("s/a.png");
    const { fetchImpl } = stub(reply([issue("Cash card", "$NaN"), issue("Budget table", "Utilit", false)]));
    const { verdicts } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(verdicts[0].issues).toEqual(['Cash card: "$NaN"', 'Budget table: "Utilit" (not sure)']);
  });
});

describe("reviewing", () => {
  it("marks a non-JSON reply as unsure and keeps going", async () => {
    png("s/a.png"); png("s/b.png");
    const garbled = { ok: true, status: 200, json: async () => ({ message: { role: "assistant", content: "oops" }, done: true }) };
    const { fetchImpl } = stub(garbled, reply());
    const { verdicts } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(verdicts.map((v) => v.verdict)).toEqual(["unsure", "pass"]);
    expect(verdicts[0].issues.join(" ")).toContain("oops");
  });
  it("sends the screenshot, the model settings and keep_alive 0 only on the last request", async () => {
    png("s/a.png"); png("s/b.png");
    const { fetchImpl, calls } = stub(reply(), reply());
    await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(calls.map((c) => c.url)).toEqual(["http://127.0.0.1:11434/api/chat", "http://127.0.0.1:11434/api/chat"]);
    expect(calls[0].body).toMatchObject({ model: "qwen3.6:35b", think: false, stream: false, options: { temperature: 0, num_ctx: 8192 } });
    expect(calls[0].body.messages.at(-1).images).toEqual([Buffer.from("s/a.png").toString("base64")]);
    expect("keep_alive" in calls[0].body).toBe(false);
    expect(calls[1].body.keep_alive).toBe(0);
  });
  it("a server error for one screenshot marks it unsure and keeps going", async () => {
    png("s/a.png"); png("s/b.png");
    const serverError = { ok: false, status: 500, json: async () => ({ error: "failed to decode image" }), text: async () => '{"error":"failed to decode image"}' };
    const { fetchImpl } = stub(serverError, reply());
    const { verdicts } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(verdicts.map((v) => v.verdict)).toEqual(["unsure", "pass"]);
    expect(verdicts[0].issues.join(" ")).toContain("500");
  });
  it("a reply body that is not JSON marks that screenshot unsure and keeps going", async () => {
    png("s/a.png"); png("s/b.png");
    const htmlBody = { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); }, text: async () => "<html>" };
    const { fetchImpl } = stub(htmlBody, reply());
    const { verdicts } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(verdicts.map((v) => v.verdict)).toEqual(["unsure", "pass"]);
  });
  it("keeps the verdicts so far when the model stops answering partway", async () => {
    png("s/a.png"); png("s/b.png");
    const { fetchImpl } = stub(reply([issue("Cash card", "$NaN")]), new TypeError("fetch failed"));
    const error = await reviewScreens({ dir, fetchImpl, log: quiet }).catch((e) => e);
    expect(error).toBeInstanceOf(ModelUnavailableError);
    expect(error.partial.verdicts.map((v) => v.verdict)).toEqual(["fail"]);
    expect(error.partial.summary).toContain("Stopped after 1 of 2");
    expect(error.partial.summary).toContain('s/a.png: Cash card: "$NaN"');
  });
  it("throws ModelUnavailableError when the host refuses", async () => {
    png("s/a.png");
    const { fetchImpl } = stub(new TypeError("fetch failed"));
    await expect(reviewScreens({ dir, fetchImpl, log: quiet })).rejects.toBeInstanceOf(ModelUnavailableError);
  });
  it("throws ModelUnavailableError when the model is missing", async () => {
    png("s/a.png");
    const missing = { ok: false, status: 404, json: async () => ({ error: 'model "qwen3.6:35b" not found, try pulling it first' }), text: async () => '{"error":"model \\"qwen3.6:35b\\" not found, try pulling it first"}' };
    const { fetchImpl } = stub(missing);
    await expect(reviewScreens({ dir, fetchImpl, log: quiet })).rejects.toThrow(/not found/);
  });
  it("summary lists counts and only non-pass screens with their paths", async () => {
    png("f415/ok.png"); png("f415/bad.png"); png("f414/odd.png");
    const { fetchImpl } = stub(reply([issue("Main area", "cannot tell the theme", false)]), reply([issue("Cash tile", "$NaN")]), reply());
    const { summary } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(summary).toContain("3 screenshots, 1 look right, 1 flagged, 1 unsure");
    expect(summary).toContain('f415/bad.png: Cash tile: "$NaN"');
    expect(summary).toContain('f414/odd.png: Main area: "cannot tell the theme" (not sure)');
    expect(summary).not.toContain("ok.png");
  });
  it("an empty folder gives 'No screenshots found' and sends no requests", async () => {
    const { fetchImpl, calls } = stub();
    const { verdicts, summary } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(verdicts).toEqual([]);
    expect(summary).toContain("No screenshots found");
    expect(calls).toEqual([]);
  });
});

// If Ollama is not running, the review starts it (ollama serve, in the background) and waits for it, instead of giving up with exit 3.
describe("starting Ollama", () => {
  const up = { ok: true, status: 200, json: async () => ({ version: "0.40.16" }) };
  const down = new TypeError("fetch failed");
  const server = (...answers) => { const urls = []; return { urls, fetchImpl: async (url) => { urls.push(url); const a = answers[Math.min(urls.length, answers.length) - 1]; if (a instanceof Error) throw a; return a; } }; };
  const spawner = () => { const runs = []; return { runs, spawnImpl: (cmd, args, opts) => { runs.push({ cmd, args, opts }); return { unref() {}, on() {} }; } }; };
  const exe = () => { const f = path.join(dir, "ollama.exe"); fs.writeFileSync(f, ""); return f; };

  it("leaves a running server alone", async () => {
    const s = server(up), p = spawner();
    expect(await ensureOllama({ fetchImpl: s.fetchImpl, spawnImpl: p.spawnImpl, ollamaPath: exe(), log: quiet })).toBe("running");
    expect(s.urls[0]).toBe("http://127.0.0.1:11434/api/version");
    expect(p.runs).toHaveLength(0);
  });
  it("starts ollama serve in the background when the server is down and waits until it answers", async () => {
    const s = server(down, down, up), p = spawner(), ollama = exe();
    expect(await ensureOllama({ fetchImpl: s.fetchImpl, spawnImpl: p.spawnImpl, ollamaPath: ollama, pollMs: 1, log: quiet })).toBe("started");
    expect(p.runs).toEqual([{ cmd: ollama, args: ["serve"], opts: expect.objectContaining({ detached: true, stdio: "ignore", windowsHide: true }) }]);
  });
  it("reports not-started when Ollama is not installed", async () => {
    const p = spawner();
    expect(await ensureOllama({ fetchImpl: server(down).fetchImpl, spawnImpl: p.spawnImpl, ollamaPath: path.join(dir, "missing.exe"), log: quiet })).toBe("not-started");
    expect(p.runs).toHaveLength(0);
  });
  it("reports not-started when the server never answers in time", async () => {
    expect(await ensureOllama({ fetchImpl: server(down).fetchImpl, spawnImpl: spawner().spawnImpl, ollamaPath: exe(), pollMs: 1, waitMs: 20, log: quiet })).toBe("not-started");
  });
  it("does not start anything for a host on another machine", async () => {
    const p = spawner();
    expect(await ensureOllama({ host: "http://192.168.1.20:11434", fetchImpl: server(down).fetchImpl, spawnImpl: p.spawnImpl, ollamaPath: exe(), log: quiet })).toBe("not-started");
    expect(p.runs).toHaveLength(0);
  });
});
