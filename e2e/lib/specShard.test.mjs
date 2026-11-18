import { describe, expect, it } from "vitest";
import { parseShard, shardSpecs } from "./specShard.mjs";

const names = n => Array.from({ length: n }, (_, i) => `feature${i + 1}.mjs`);

describe("--shard=INDEX/TOTAL", () => {
  it("is absent unless asked for", () => {
    expect(parseShard(["node", "run-all.mjs", "--concurrency=1"])).toBeUndefined();
  });
  it("reads a one-based index and a total", () => {
    expect(parseShard(["--shard=2/6"])).toEqual({ index: 2, total: 6 });
    expect(parseShard(["--shard=1/1"])).toEqual({ index: 1, total: 1 });
  });
  it.each(["--shard=", "--shard=2", "--shard=0/4", "--shard=5/4", "--shard=a/4", "--shard=1/0", "--shard=1.5/4", "--shard=-1/4", "--shard=1/4/2"])(
    "refuses %s",
    arg => {
      expect(() => parseShard([arg])).toThrow(/--shard/);
    },
  );
});

describe("splitting the specs between shards", () => {
  const specs = names(40);
  const durations = Object.fromEntries(specs.map((s, i) => [s, 1000 + ((i * 7919) % 30) * 1000]));
  const shards = total => Array.from({ length: total }, (_, i) => shardSpecs(specs, durations, { index: i + 1, total }));

  it("gives every spec to exactly one shard", () => {
    for (const total of [1, 2, 3, 5, 8]) {
      const all = shards(total).flat();
      expect([...all].sort()).toEqual([...specs].sort());
      expect(new Set(all).size).toBe(specs.length);
    }
  });
  it("returns everything for a single shard, in the order given", () => {
    expect(shardSpecs(specs, durations, { index: 1, total: 1 })).toEqual(specs);
  });
  it("keeps the order the specs were given in within a shard", () => {
    for (const shard of shards(4)) {
      const positions = shard.map(s => specs.indexOf(s));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });
  it("is the same every time", () => {
    expect(shards(5)).toEqual(shards(5));
  });
  it("balances the recorded run time, so no shard is far longer than the rest", () => {
    const load = shard => shard.reduce((sum, s) => sum + durations[s], 0);
    const loads = shards(6).map(load);
    const longest = Math.max(...specs.map(s => durations[s]));
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(longest);
  });
  it("does not let one slow spec share a shard with a pile of others when it can sit alone", () => {
    const two = ["slow.mjs", "a.mjs", "b.mjs", "c.mjs"];
    const d = { "slow.mjs": 100000, "a.mjs": 30000, "b.mjs": 30000, "c.mjs": 30000 };
    const [first, second] = [1, 2].map(index => shardSpecs(two, d, { index, total: 2 }));
    expect([first, second].map(s => s.length).sort()).toEqual([1, 3]);
    expect([first, second].find(s => s.includes("slow.mjs"))).toEqual(["slow.mjs"]);
  });
  it("gives a spec with no recorded time the typical time, so new specs still spread out", () => {
    const fresh = names(12);
    const known = { "feature1.mjs": 4000, "feature2.mjs": 6000, "feature3.mjs": 8000 };
    const sizes = [1, 2, 3].map(index => shardSpecs(fresh, known, { index, total: 3 }).length);
    expect(sizes.every(n => n >= 3 && n <= 5)).toBe(true);
  });
  it("spreads specs evenly when nothing has been recorded at all", () => {
    const sizes = [1, 2, 3, 4].map(index => shardSpecs(names(10), {}, { index, total: 4 }).length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });
  it("can leave a shard empty when there are fewer specs than shards", () => {
    expect(shardSpecs(["a.mjs"], {}, { index: 2, total: 3 })).toEqual([]);
    expect(shardSpecs(["a.mjs"], {}, { index: 1, total: 3 }).concat(shardSpecs(["a.mjs"], {}, { index: 3, total: 3 }))).toEqual(["a.mjs"]);
  });
  it("refuses a shard outside the total", () => {
    expect(() => shardSpecs(specs, durations, { index: 4, total: 3 })).toThrow(/shard/);
  });
});
