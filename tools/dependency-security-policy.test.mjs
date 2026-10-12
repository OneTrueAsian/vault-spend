import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rustFindings, npmFindings } from './dependency-security-policy.mjs';
const advisory = { advisory: { id: 'RUSTSEC-2026-0235' }, package: { name: 'rkyv', version: '0.7.46' } };
const scan = list => ({ database: { 'last-commit': 'revision' }, vulnerabilities: { list } });
test('no advisory is waived: a finding is only allowed when it is an unreachable unsound notice', () => {
  // RUSTSEC-2026-0235 (rkyv 0.7.46) was waived until rust_decimal 1.43 removed it; it must now block.
  assert.equal(rustFindings(scan([advisory]), 'rust_decimal v1.43.0', 'x86_64-pc-windows-msvc', '2026-10-09')[0].permitted, false);
  assert.equal(rustFindings(scan([advisory]), 'rkyv v0.7.46', 'x86_64-pc-windows-msvc', '2026-10-09')[0].permitted, false);
  const unsound = { advisory: { id: 'RUSTSEC-0000-0000', informational: 'unsound' }, package: { name: 'glib', version: '0.1.0' } };
  assert.equal(rustFindings({ ...scan([]), warnings: { unsound: [unsound] } }, 'rust_decimal v1.43.0', 'x86_64-pc-windows-msvc', '2026-10-09')[0].permitted, true);
  assert.equal(rustFindings({ ...scan([]), warnings: { unsound: [unsound] } }, 'glib v0.1.0', 'x86_64-pc-windows-msvc', '2026-10-09')[0].permitted, false);
});
test('scan failures never look like a clean audit', () => {
  assert.throws(() => rustFindings({}, 'tree', 'x86_64-pc-windows-msvc'));
  assert.throws(() => npmFindings({ error: { code: 'NETWORK' } }));
  assert.equal(npmFindings({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } }), 0);
});
