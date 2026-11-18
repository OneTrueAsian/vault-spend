// --shard=INDEX/TOTAL: runs one slice of the selected specs, so a hosted job can run its share and the other
// jobs run the rest at the same time. The split is deterministic and balanced by each spec's last recorded
// run time (longest first onto the lightest shard), so every job gets about the same amount of work.

/** `{ index, total }` (index counts from 1) for `--shard=2/6`, or undefined when the flag is absent. */
export function parseShard(argv) {
  const arg = argv.find(a => a === "--shard" || a.startsWith("--shard="));
  if (arg === undefined) return undefined;
  const match = /^--shard=(\d+)\/(\d+)$/.exec(arg);
  if (!match) throw new Error(`--shard must look like --shard=2/6 (this shard's number, then how many shards there are), got "${arg}"`);
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1 || index < 1 || index > total) throw new Error(`--shard=${index}/${total} is outside the shards: the number must be from 1 to the total`);
  return { index, total };
}

/** The specs for shard `index` of `total`, in the order they were given. `durations` maps a spec name to its last run time in ms. */
export function shardSpecs(specs, durations, { index, total }) {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(index) || index < 1 || index > total) {
    throw new Error(`shard ${index}/${total} is outside the shards: the number must be from 1 to the total`);
  }
  if (total === 1) return [...specs];
  const known = specs.map(name => durations[name]).filter(ms => Number.isFinite(ms) && ms > 0).sort((a, b) => a - b);
  // A spec with no recorded time (new since the last run) counts as a typical one, so new specs still spread out.
  const typical = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = name => (Number.isFinite(durations[name]) && durations[name] > 0 ? durations[name] : typical);
  const order = specs.map((name, position) => ({ name, position })).sort((a, b) => weight(b.name) - weight(a.name) || a.position - b.position);
  const loads = Array.from({ length: total }, () => 0);
  const shardOf = new Map();
  for (const { name } of order) {
    const lightest = loads.indexOf(Math.min(...loads));
    shardOf.set(name, lightest);
    loads[lightest] += weight(name);
  }
  return specs.filter(name => shardOf.get(name) === index - 1);
}
