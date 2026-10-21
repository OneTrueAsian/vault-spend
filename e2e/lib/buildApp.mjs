// Build the Tauri app under exclusive access, reuse an executable only when its complete inputs match (R1d), and record what an
// executable was built from only when nothing changed while it was being built (R1c). `runBuild` is the actual compiler step.
import fs from "node:fs";
import { computeBuildKey, diffInputs, recordArtifact, verifyArtifact } from "./buildIdentity.mjs";
import { acquireAccess } from "./exclusiveAccess.mjs";

export async function buildArtifact({ lockDir, exePath, recordPath, collectInputs, toolchain, mode, runBuild, force = false, wait = true, timeoutMs = 30 * 60 * 1000, pollMs }) {
  const lock = await acquireAccess({ dir: lockDir, operation: "tauri-build", wait, timeoutMs, pollMs });
  try {
    const before = await collectInputs();
    const key = computeBuildKey({ files: before, toolchain, mode });
    const artifact = verifyArtifact({ exePath, recordPath, currentKey: key });
    if (!force && artifact.status === "fresh") return { action: "reused", artifact };

    fs.rmSync(recordPath, { force: true }); // while it compiles, nothing may vouch for the executable on disk
    await runBuild();
    if (!fs.existsSync(exePath)) throw new Error(`The build finished but produced no executable at ${exePath}.`);
    const diff = diffInputs(before, await collectInputs());
    if (diff.added.length || diff.removed.length || diff.changed.length) {
      const names = [...diff.changed, ...diff.added, ...diff.removed].join(", ");
      throw new Error(`Source files changed during the build (${names}); the executable was not recorded as built from the starting inputs. Build again once the edits are finished.`);
    }
    recordArtifact({ exePath, recordPath, key });
    return { action: "built", artifact: verifyArtifact({ exePath, recordPath, currentKey: key }) };
  } finally { lock.release(); }
}
