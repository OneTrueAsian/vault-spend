import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const modulePath = require.resolve('picomatch');

test('tooling resolves the reviewed local patch rather than a stale registry copy', () => {
  const installedRoot = path.dirname(modulePath);
  for (const file of ['index.js', 'posix.js', 'lib/parse.js', 'lib/picomatch.js', 'lib/scan.js', 'lib/utils.js', 'lib/constants.js']) {
    assert.deepEqual(fs.readFileSync(path.join(installedRoot, file)),
      fs.readFileSync(new URL(`./vendor/picomatch/${file}`, import.meta.url)), file);
  }
  for (const consumer of ['vite', 'vitest', 'tinyglobby', 'fdir']) {
    assert.equal(createRequire(require.resolve(consumer)).resolve('picomatch'), modulePath, consumer);
  }
});

test('repeated extglobs with a wildcard cannot stall the matcher (CVE-2026-112366)', () => {
  for (const pattern of ['+(*)b', '+(*a)b', '*(*)b', '*(*a)b', '+(@(*a))b', '+([ab]*)b']) {
    const result = spawnSync(process.execPath, ['-e', `
      const pm = require(process.argv[1]);
      if (pm.isMatch('a'.repeat(48) + '!', process.argv[2])) process.exit(1);
    `, modulePath, pattern], { timeout: 2000, encoding: 'utf8', windowsHide: true });
    assert.equal(result.error, undefined, `${pattern}: ${result.error?.message}`);
    assert.equal(result.status, 0, `${pattern}: ${result.stderr}`);
  }
});

test('normal tooling glob semantics remain available', () => {
  const pm = require('picomatch');
  for (const [glob, yes, no] of [
    ['**/*.{ts,tsx}', 'src/app/App.tsx', 'src/app/style.css'],
    ['**/*.test.?([cm])js', 'tools/security.test.mjs', 'tools/security.js'],
    ['+(foo|bar).js', 'foobar.js', 'baz.js'],
    ['!**/node_modules/**', 'src/main.tsx', 'node_modules/a/index.js'],
    ['src/**/!(*.test).tsx', 'src/app/App.tsx', 'src/app/App.test.tsx'],
  ]) {
    assert.equal(pm.isMatch(yes, glob), true, `${glob} matches ${yes}`);
    assert.equal(pm.isMatch(no, glob), false, `${glob} excludes ${no}`);
  }
});
