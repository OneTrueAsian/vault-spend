import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rustFindings, npmFindings } from './dependency-security-policy.mjs';
const advisory = { advisory: { id: 'RUSTSEC-2026-0235' }, package: { name: 'rkyv', version: '0.7.46' } };
const scan = list => ({ database: { 'last-commit': 'revision' }, vulnerabilities: { list } });
test('optional exception cannot permit a reachable, changed or expired dependency', () => {
  assert.equal(rustFindings(scan([advisory]), 'rust_decimal v1.42.0', 'x86_64-pc-windows-msvc', '2026-10-09')[0].permitted, true);
  assert.equal(rustFindings(scan([advisory]), 'rkyv v0.7.46', 'x86_64-pc-windows-msvc', '2026-10-09')[0].permitted, false);
  assert.equal(rustFindings(scan([advisory]), 'rust_decimal v1.42.0', 'x86_64-pc-windows-msvc', '2026-11-09')[0].permitted, false);
  assert.equal(rustFindings(scan([{ ...advisory, advisory: { id: 'NEW-ADVISORY' } }]), 'rust_decimal v1.42.0', 'x86_64-pc-windows-msvc', '2026-10-09')[0].permitted, false);
});
test('scan failures never look like a clean audit', () => {
  assert.throws(() => rustFindings({}, 'tree', 'x86_64-pc-windows-msvc'));
  assert.throws(() => npmFindings({ error: { code: 'NETWORK' } }));
  assert.equal(npmFindings({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } }), 0);
});
