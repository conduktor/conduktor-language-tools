// Regenerates contributes.languageModelTools in package.json from the core tool definitions.
import { build } from 'esbuild';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const bundle = fileURLToPath(new URL('../out/tool-definitions.cjs', import.meta.url));
await build({
  stdin: { contents: "export { conduktorTools } from '@conduktor/core';", resolveDir: process.cwd() },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: bundle,
  logLevel: 'silent',
});
const { conduktorTools } = createRequire(import.meta.url)(bundle);
await rm(bundle);

const manifestPath = new URL('../package.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.contributes.languageModelTools = conduktorTools.map((tool) => ({
  name: tool.name,
  displayName: tool.title,
  modelDescription: tool.description,
  userDescription: tool.title,
  toolReferenceName: tool.name.replace(/_(\w)/g, (_, letter) => letter.toUpperCase()),
  canBeReferencedInPrompt: true,
  tags: ['conduktor', 'kafka'],
  inputSchema: tool.inputSchema,
}));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${conduktorTools.length} tools written to package.json`);
