import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// What a bundle may hold: licenses that ask only for their notice to travel with the code. Anything else, a copyleft
// license or none at all, stops the build until someone has looked at it.
const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense',
  'Zlib',
]);
const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:\.(?:md|txt))?$/i;
// A package that bundles others carries their notices in a file of its own (prettier, vscode-languageserver).
const NOTICES_FILE = /^(?:third[-_]?party[-_]?notices|notice)(?:\.(?:md|txt))?$/i;

const repository = resolve(dirname(new URL(import.meta.url).pathname), '..');
// What a package's npm release leaves out, taken from the source repositories at the release's tag, in
// scripts/licenses/<package name>/: its LICENSE when it ships none, and the notices of code it bundles itself.
const VENDORED = join(repository, 'scripts', 'licenses');
// Text bundled from outside npm, by the file it is in: where it comes from, under which license, and its notice.
const CONTENT = {
  'packages/core/snapshot/topic-configs.json': {
    name: 'Apache Kafka documentation, topic configuration reference 4.2',
    license: 'Apache-2.0',
    notice: join(VENDORED, 'content', 'apache-kafka-docs.NOTICE'),
  },
};

/**
 * Writes, next to bundles, the repository's LICENSE and THIRD_PARTY_NOTICES.md: the license, and any notices, of each
 * npm package esbuild put in them, read from their metafiles. Throws when a package's license is not one of ALLOWED,
 * or when it ships no license text to reproduce.
 */
export function writeNotices(outdir, metafiles) {
  const packages = new Map();
  const content = new Set();
  for (const metafile of metafiles)
    for (const input of Object.keys(metafile.inputs)) {
      const directory = packageDirectory(resolve(input));
      if (directory && !packages.has(directory)) packages.set(directory, describe(directory));
      const file = relative(repository, resolve(input));
      if (file in CONTENT) content.add(CONTENT[file]);
    }
  const refused = [...packages.values()].filter((pkg) => !allowed(pkg.license) || !pkg.text);
  if (refused.length > 0)
    throw new Error(
      `Bundled packages whose license is not allowed or not shipped:\n${refused
        .map(
          (pkg) =>
            `  ${pkg.name}@${pkg.version}: ${pkg.license ?? 'no license field'}${pkg.text ? '' : ', no license file'}`,
        )
        .join('\n')}`,
    );
  const bundledText = [...content].map((c) =>
    [`## ${c.name} (${c.license})`, '', fenced(readFileSync(c.notice, 'utf8').trim())].join('\n\n'),
  );
  const sections = [...packages.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
    .map((pkg) =>
      [`## ${pkg.name} ${pkg.version} (${pkg.license})`, '', fenced(pkg.text), ...pkg.notices.map(fenced)].join('\n\n'),
    );
  writeFileSync(
    join(outdir, 'THIRD_PARTY_NOTICES.md'),
    `# Third-party notices\n\nThe bundled files in this folder include the following packages and text, under these licenses.\n\n${[...sections, ...bundledText].join('\n\n')}\n`,
  );
  copyFileSync(join(repository, 'LICENSE'), join(outdir, 'LICENSE'));
}

// The package an input file belongs to: the folder after its last node_modules/ (and its scope).
function packageDirectory(path) {
  const parts = path.split(sep);
  const at = parts.lastIndexOf('node_modules');
  if (at === -1) return undefined;
  const length = parts[at + 1]?.startsWith('@') ? 3 : 2;
  return parts.slice(0, at + length).join(sep);
}

function describe(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const files = readdirSync(directory);
  const read = (pattern) =>
    files.filter((file) => pattern.test(file)).map((file) => readFileSync(join(directory, file), 'utf8').trim());
  const vendored = join(VENDORED, manifest.name);
  const extra = existsSync(vendored) ? readdirSync(vendored) : [];
  const vendor = (file) => readFileSync(join(vendored, file), 'utf8').trim();
  return {
    name: manifest.name,
    version: manifest.version,
    license: typeof manifest.license === 'string' ? manifest.license : undefined,
    text: read(LICENSE_FILE)[0] ?? (extra.includes('LICENSE') ? vendor('LICENSE') : undefined),
    notices: [...read(NOTICES_FILE), ...extra.filter((file) => file !== 'LICENSE').map(vendor)],
  };
}

// An SPDX expression is allowed when one of its OR alternatives is made only of allowed licenses.
function allowed(expression) {
  if (!expression) return false;
  return expression
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .some((alternative) => alternative.split(/\s+AND\s+/).every((id) => ALLOWED.has(id.trim())));
}

function fenced(text) {
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(([run]) => run.length + 1)));
  return `${fence}text\n${text}\n${fence}`;
}
