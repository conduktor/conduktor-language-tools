import { build, context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { globSync, readFileSync } from 'node:fs';
import { writeNotices } from '../../scripts/third-party-notices.mjs';

const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

const extension = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  sourcemap: true,
  metafile: true,
  logLevel: 'info',
};

// Claude Code and other MCP clients run this with node; it reads the bundled OpenAPI next to it.
const mcpServer = {
  ...extension,
  entryPoints: ['../../packages/mcp/src/main.ts'],
  outfile: 'dist/mcp-server.js',
  external: [],
  define: { CONDUKTOR_VERSION: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version) },
};

await mkdir('dist', { recursive: true });
await cp('../../packages/core/snapshot/public-api-doc.yaml', 'dist/public-api-doc.yaml');

if (watch) {
  await (await context(extension)).watch();
  await (await context(mcpServer)).watch();
} else {
  const bundles = [await build(extension), await build(mcpServer)];
  writeNotices(
    'dist',
    bundles.map((bundle) => bundle.metafile),
  );
  if (tests) {
    const { outfile: _outfile, ...shared } = extension;
    await build({
      ...shared,
      entryPoints: globSync('src/test/**/*.test.ts'),
      outdir: 'out/test',
      external: ['vscode', 'mocha'],
    });
  }
}
