// npm run e2e:review: a local vision model (Ollama) reviews kept screenshots so an agent reads a short summary instead of every image.
// Ollama is replaced by a recorded stand-in here; the request and reply shapes are Ollama's /api/chat.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelUnavailableError, findScreens, promptFor, reviewScreens } from "./screenReview.mjs";

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-review-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const png = (rel) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(rel)); return f; };
const reply = (verdict, issues = []) => ({ ok: true, status: 200, json: async () => ({ model: "qwen3.6:35b", message: { role: "assistant", content: JSON.stringify({ verdict, issues }) }, done: true, prompt_eval_count: 1300, eval_count: 40 }) });
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
  });
});

describe("reviewing", () => {
  it("marks a non-JSON reply as unsure and keeps going", async () => {
    png("s/a.png"); png("s/b.png");
    const garbled = { ok: true, status: 200, json: async () => ({ message: { role: "assistant", content: "oops" }, done: true }) };
    const { fetchImpl } = stub(garbled, reply("pass"));
    const { verdicts } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(verdicts.map((v) => v.verdict)).toEqual(["unsure", "pass"]);
    expect(verdicts[0].issues.join(" ")).toContain("oops");
  });
  it("sends the screenshot, the model settings and keep_alive 0 only on the last request", async () => {
    png("s/a.png"); png("s/b.png");
    const { fetchImpl, calls } = stub(reply("pass"), reply("pass"));
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
    const { fetchImpl } = stub(serverError, reply("pass"));
    const { verdicts } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(verdicts.map((v) => v.verdict)).toEqual(["unsure", "pass"]);
    expect(verdicts[0].issues.join(" ")).toContain("500");
  });
  it("a reply body that is not JSON marks that screenshot unsure and keeps going", async () => {
    png("s/a.png"); png("s/b.png");
    const htmlBody = { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); }, text: async () => "<html>" };
    const { fetchImpl } = stub(htmlBody, reply("pass"));
    const { verdicts } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(verdicts.map((v) => v.verdict)).toEqual(["unsure", "pass"]);
  });
  it("keeps the verdicts so far when the model stops answering partway", async () => {
    png("s/a.png"); png("s/b.png");
    const { fetchImpl } = stub(reply("fail", ["$NaN"]), new TypeError("fetch failed"));
    const error = await reviewScreens({ dir, fetchImpl, log: quiet }).catch((e) => e);
    expect(error).toBeInstanceOf(ModelUnavailableError);
    expect(error.partial.verdicts.map((v) => v.verdict)).toEqual(["fail"]);
    expect(error.partial.summary).toContain("Stopped after 1 of 2");
    expect(error.partial.summary).toContain("s/a.png: $NaN");
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
    const { fetchImpl } = stub(reply("unsure", ["cannot tell the theme"]), reply("fail", ["$NaN in the Cash tile"]), reply("pass"));
    const { summary } = await reviewScreens({ dir, fetchImpl, log: quiet });
    expect(summary).toContain("3 screenshots, 1 look right, 1 flagged, 1 unsure");
    expect(summary).toContain("f415/bad.png: $NaN in the Cash tile");
    expect(summary).toContain("f414/odd.png: cannot tell the theme");
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
