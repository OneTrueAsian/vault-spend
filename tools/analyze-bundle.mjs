// Rollup's rendered module sizes are attribution estimates; gzip is measured per output.
import { build, loadConfigFromFile } from 'vite';
import { gzipSync } from 'node:zlib';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: node tools/analyze-bundle.mjs <external-output-directory>');
const relative = path.relative(process.cwd(), path.resolve(destination));
if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('Choose an output directory outside the repository');
mkdirSync(destination, { recursive: true });
if (readdirSync(destination).length) throw new Error('Bundle analysis requires an empty output directory');
for (const [name, configFile] of [['desktop', 'vite.config.ts'], ['mobile', 'vite.mobile.config.ts']]) {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.resolve(configFile));
  if (!loaded) throw new Error(`Cannot load ${configFile}`);
  const chunks = [];
  await build({ ...loaded.config, configFile: false, plugins: [...loaded.config.plugins, {
    name: 'bundle-attribution',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) if (item.type === 'chunk') chunks.push({
        file: item.fileName, entry: item.isEntry, imports: item.imports, dynamicImports: item.dynamicImports,
        bytes: Buffer.byteLength(item.code), gzipBytes: gzipSync(item.code).length,
        modules: Object.entries(item.modules).map(([id, info]) => ({ id: path.relative(process.cwd(), id).replaceAll('\\', '/'), renderedBytes: info.renderedLength })).sort((a, b) => b.renderedBytes - a.renderedBytes),
      });
    },
  }], build: { ...loaded.config.build, outDir: path.join(destination, name) } });
  const result = { name, note: 'Minified bytes and independently compressed gzip bytes. Module renderedBytes are pre-minifier estimates, not startup timings.', chunks };
  writeFileSync(path.join(destination, `${name}-bundle.json`), JSON.stringify(result, null, 2));
  console.log(`${name}: ${chunks.reduce((n, c) => n + c.bytes, 0)} JS bytes; ${chunks.reduce((n, c) => n + c.gzipBytes, 0)} gzip bytes`);
}
