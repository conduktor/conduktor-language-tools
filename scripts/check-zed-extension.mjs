// Checks extensions/zed the way Zed's extension registry does before it accepts an extension, with the registry's
// own code (checked out at REGISTRY_DIR) and its zed-extension CLI (ZED_EXTENSION_CLI). The workflow pins both to the
// commits the registry runs.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const registry = resolve(process.env.REGISTRY_DIR ?? '.zed-registry');
const cli = resolve(process.env.ZED_EXTENSION_CLI ?? 'zed-extension');
const source = resolve('extensions/zed');
const lib = (file) => import(pathToFileURL(join(registry, 'src', 'lib', file)).href);
const { validateExtensionsToml, validateLicense, validateManifest } = await lib('validation.js');
const { readTomlFile, retrieveLicenseCandidates } = await lib('fs.js');

const toml = await readTomlFile(join(source, 'extension.toml'));
const failed = [];
async function check(what, run) {
  try {
    await run();
    console.log(`ok    ${what}`);
  } catch (error) {
    failed.push(what);
    console.log(`FAIL  ${what}\n${error instanceof Error ? error.message : error}\n`);
  }
}

await check('the id and version, as an entry of the registry would hold them', () =>
  validateExtensionsToml({
    [toml.id]: { submodule: `extensions/${toml.id}`, path: 'extensions/zed', version: toml.version },
  }),
);

await check('the wasm build and the manifest the registry publishes', () => {
  const output = mkdtempSync(join(tmpdir(), 'zed-extension-output-'));
  execFileSync(
    cli,
    [
      '--scratch-dir',
      mkdtempSync(join(tmpdir(), 'zed-extension-scratch-')),
      '--source-dir',
      source,
      '--output-dir',
      output,
    ],
    { stdio: 'inherit' },
  );
  const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
  if (manifest.version !== toml.version)
    throw new Error(`The manifest says version ${manifest.version}, extension.toml ${toml.version}.`);
  validateManifest(manifest);
});

await check('the license', async () => validateLicense(await retrieveLicenseCandidates(source)));

if (failed.length > 0) {
  console.log(`${failed.length} of 3 checks failed: ${failed.join('; ')}.`);
  process.exit(1);
}
