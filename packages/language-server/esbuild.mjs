import { build } from 'esbuild';
import { chmod, cp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { outdir: { type: 'string', default: 'dist' } } });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
// .cjs: the package is an ES module, and yaml-language-server's UMD build needs require.
const outfile = join(values.outdir, 'server.cjs');

await mkdir(values.outdir, { recursive: true });
await cp('../core/snapshot/public-api-doc.yaml', join(values.outdir, 'public-api-doc.yaml'));
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // jsonc-parser, vscode-json-languageservice and others ship UMD as main, whose requires esbuild cannot follow.
  mainFields: ['module', 'main'],
  outfile,
  banner: { js: '#!/usr/bin/env node' },
  define: { CONDUKTOR_VERSION: JSON.stringify(version) },
  sourcemap: true,
  logLevel: 'warning',
});
await chmod(outfile, 0o755);
