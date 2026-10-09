import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { makeTempDir } from '../e2e/lib/tempDir.mjs';

const driverRequire = createRequire(import.meta.resolve('@wdio/utils'));
const browserModule = pathToFileURL(driverRequire.resolve('@puppeteer/browsers'));
const { install, resolveBuildId, Browser, BrowserPlatform, computeExecutablePath } = await import(browserModule);
const { extractZipWithYauzl } = await import(new URL('./fileUtil.js', browserModule));

async function fixture(archive, check) {
  const cacheDir = makeTempDir('vaultspend-browser-download-');
  let requests = 0;
  const server = createServer((req, res) => { requests++; res.writeHead(200, { 'Content-Length': archive.length }); res.end(archive); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await check({ cacheDir, browser: Browser.CHROME, platform: BrowserPlatform.WIN64, buildId: '1.2.3.4',
    baseUrl: `http://127.0.0.1:${server.address().port}`, installDeps: false }, () => requests); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('patched downloader preserves the driver install, version, cache and executable-path APIs', async () => {
  const zip = new JSZip(); zip.file('chrome-win64/chrome.exe', 'inert browser fixture, never executed');
  await fixture(await zip.generateAsync({ type: 'nodebuffer' }), async (options, requests) => {
    assert.equal(await resolveBuildId(Browser.CHROME, BrowserPlatform.WIN64, '1.2.3.4'), '1.2.3.4');
    const installed = await install(options);
    assert.equal(fs.readFileSync(installed.executablePath, 'utf8'), 'inert browser fixture, never executed');
    assert.equal(computeExecutablePath(options), installed.executablePath);
    await install(options); assert.equal(requests(), 1, 'valid cached fixture must avoid another download');
  });
});

test('patched ZIP parser rejects a link leaving the extraction directory before creating it', async () => {
  const zip = new JSZip(); zip.file('chrome-win64/escape', '../../../escape', { unixPermissions: 0o120777 });
  const directory = makeTempDir('vaultspend-browser-zip-');
  const archive = path.join(directory, 'fixture.zip'), output = path.join(directory, 'output');
  fs.writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }));
  fs.mkdirSync(output);
  // install prefers the platform archiver. Exercise the pinned JS fallback explicitly, without
  // inferring that every platform's native tool rejects the same archive (some strip link metadata).
  await assert.rejects(extractZipWithYauzl(archive, output), /Extraction failed|outside/);
  assert.equal(fs.existsSync(path.join(directory, 'escape')), false);
});
