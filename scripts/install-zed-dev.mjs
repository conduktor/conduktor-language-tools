import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// The Zed extension runs the server it finds on the PATH before it looks on npm: a link in ~/.local/bin makes it
// run this build.
const target = resolve('packages/language-server/dist/server.cjs');
const bin = join(homedir(), '.local', 'bin');
const link = join(bin, 'conduktor-console-language-server');

mkdirSync(bin, { recursive: true });
if (existsSync(link) && !lstatSync(link).isSymbolicLink()) {
  console.error(`${link} exists and is not a link to a build: remove it first.`);
  process.exit(1);
}
rmSync(link, { force: true });
symlinkSync(target, link);
console.log(`${link} -> ${target}`);
if (!process.env.PATH?.split(':').includes(bin)) {
  console.warn(`${bin} is not on your PATH: add it, or the extension will look for the server on npm.`);
}
