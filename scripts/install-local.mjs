import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// The `code` command is only on PATH once installed from VS Code's palette; the app bundle always has it.
const macApp = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
const code = spawnSync('code', ['--version']).error && existsSync(macApp) ? macApp : 'code';
execFileSync(code, ['--install-extension', 'extensions/vscode/dist/conduktor-console.vsix', '--force'], {
  stdio: 'inherit',
});
