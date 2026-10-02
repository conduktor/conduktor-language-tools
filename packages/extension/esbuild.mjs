import { build, context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { globSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

const extension = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

await mkdir('dist', { recursive: true });
await cp('../core/snapshot/public-api-doc.yaml', 'dist/public-api-doc.yaml');

if (watch) {
  await (await context(extension)).watch();
} else {
  await build(extension);
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
