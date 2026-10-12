// No advisory is currently waived. An exception needs an exact advisory/package/version/target match,
// an owner, a rationale and an expiry date, and can never permit a dependency that is in the tree.
// RUSTSEC-2026-0235 (rkyv 0.7.46, optional via rust_decimal) was waived until rust_decimal 1.43 removed it.
export const exceptions = [];

export function rustFindings(audit, tree, target, today = new Date().toISOString().slice(0, 10)) {
  if (!audit.database?.['last-commit'] || !audit.vulnerabilities || !Array.isArray(audit.vulnerabilities.list) || typeof tree !== 'string' || !tree.trim()) {
    throw new Error("Rust scan or target dependency inventory did not complete.");
  }
  const findings = [...audit.vulnerabilities.list, ...(audit.warnings?.unsound ?? [])];
  return findings.map(finding => {
    const { advisory, package: pkg } = finding;
    if (!advisory?.id || !pkg?.name || !pkg?.version) throw new Error("Malformed Rust advisory result.");
    const reachable = tree.split(/\r?\n/).some(line => line === `${pkg.name} v${pkg.version}` || line.startsWith(`${pkg.name} v${pkg.version} `));
    const exception = exceptions.find(item => item.advisory === advisory.id && item.package === pkg.name && item.version === pkg.version && item.targets.includes(target) && item.expires >= today);
    // Unsound warnings for other platforms stay visible; actionable vulnerabilities require a
    // specific, expiring exception even when optional resolution is absent from the compiled tree.
    const permitted = !reachable && (advisory.informational === 'unsound' || Boolean(exception));
    return { advisory: advisory.id, package: pkg.name, version: pkg.version, reachable, permitted, exception: permitted ? exception : undefined };
  });
}

export function npmFindings(report) {
  if (report.auditReportVersion !== 2 || !report.metadata?.vulnerabilities || typeof report.metadata.vulnerabilities.total !== 'number' || !report.vulnerabilities) {
    throw new Error("npm audit did not return a complete scan.");
  }
  return report.metadata.vulnerabilities.total;
}
