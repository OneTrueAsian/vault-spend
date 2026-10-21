// The guard around a desktop run (R1): exclusive access for its whole length, a check that the executable is the one built from the
// current inputs, and a final check that neither the source nor the executable changed while it ran. A run during which either
// changed is reported as invalid evidence, with the files named; it is never quietly accepted.
//
// If the build identity cannot be computed at all (no git, rustc or cargo on this machine) the run still takes exclusive access and still
// treats the executable as immutable, but is labelled artifact=unknown with the reason; it cannot watch the source or vouch for freshness.
import { computeBuildKey, computeTestKey, diffTestFiles, diffInputs, sha256File, verifyArtifact } from "./buildIdentity.mjs";
import { acquireAccess } from "./exclusiveAccess.mjs";

export class GuardRefusal extends Error {
  constructor(status, reason) {
    super(`Refusing to run against this executable (${status}): ${reason} Rebuild with "npm run build:app", or pass --allow-stale-artifact to run anyway and have the results labelled stale.`);
    this.name = "GuardRefusal"; this.status = status;
  }
}

export async function beginGuardedRun({ operation, lockDir, exePath, recordPath, collectInputs, toolchain, mode, wait = false, timeoutMs = 0, pollMs, allowStale = false }) {
  const lock = await acquireAccess({ dir: lockDir, operation, wait, timeoutMs, pollMs });
  let start;
  try {
    let inputs = null, buildKey = null, testKey = null, artifact;
    try {
      inputs = await collectInputs();
      buildKey = computeBuildKey({ files: inputs, toolchain, mode });
      testKey = computeTestKey({ files: inputs });
    } catch (error) {
      inputs = null; buildKey = null; testKey = null;
      artifact = { status: "unknown", reason: `Build identity is unavailable on this machine (${error.message}), so freshness and source changes cannot be checked.` };
    }
    if (buildKey) artifact = verifyArtifact({ exePath, recordPath, currentKey: buildKey });
    else {
      try { artifact.exeSha256 = sha256File(exePath); } catch { artifact = { status: "missing", reason: `No executable at ${exePath}. Build it first.` }; }
    }
    if (["missing", "changed"].includes(artifact.status) || (artifact.status === "stale" && !allowStale)) throw new GuardRefusal(artifact.status, artifact.reason);
    const exeSha256 = artifact.exeSha256 ?? sha256File(exePath);
    start = { inputs, buildKey, testKey, artifact, exeSha256, startedAt: new Date().toISOString() };
  } catch (error) { lock.release(); throw error; }

  let verdict = null;
  const identityOf = finishedAt => ({
    operation, buildKey: start.buildKey, testKey: start.testKey, artifactStatus: start.artifact.status, staleAllowed: start.artifact.status === "stale" && allowStale,
    exeSha256: start.exeSha256, startedAt: start.startedAt, finishedAt, ...(start.artifact.status === "unknown" && start.buildKey === null ? { identityUnavailable: start.artifact.reason } : {}),
  });
  return {
    artifact: start.artifact,
    identity: () => identityOf(null),
    async finish() {
      if (verdict) return verdict;
      const problems = [];
      try {
        if (start.inputs) {
          const after = await collectInputs();
          const diff = diffInputs(start.inputs, after);
          if (diff.added.length || diff.removed.length || diff.changed.length) problems.push({ kind: "source-changed", ...diff });
          // A test file changed mid-run: the application is untouched, but the run is no longer evidence for one fixed set of tests (runner and document edits are not flagged, as before).
          const harness = diffTestFiles(start.inputs, after);
          if (harness.added.length || harness.removed.length || harness.changed.length) problems.push({ kind: "tests-changed", ...harness });
        }
        let now = null;
        try { now = sha256File(exePath); } catch { /* removed */ }
        if (now !== start.exeSha256) problems.push({ kind: "executable-changed", before: start.exeSha256, after: now });
      } finally { lock.release(); }
      return (verdict = { valid: problems.length === 0, problems, identity: identityOf(new Date().toISOString()) });
    },
    abort() {
      if (verdict) return;
      lock.release();
      verdict = { valid: false, problems: [{ kind: "aborted" }], identity: identityOf(new Date().toISOString()) };
    },
  };
}
